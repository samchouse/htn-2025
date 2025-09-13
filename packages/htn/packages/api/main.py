import os

from doc_processing import DocumentProcessor
from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.routing import APIRoute
from reconciliation_agent import MatchStatus, ReconciliationAgent
from scalar_fastapi import get_scalar_api_reference

app = FastAPI(title="HTN API", version="1.0.0")

# Initialize reconciliation agent
openai_api_key = os.getenv("OPENAI_API_KEY")
if not openai_api_key:
    raise ValueError("OPENAI_API_KEY environment variable is required")

reconciliation_agent = ReconciliationAgent(openai_api_key)
document_processor = DocumentProcessor(openai_api_key)


@app.post("/reconcile")
async def reconcile_files(
    bank_statement: UploadFile = File(..., description="CSV bank statement file"),
    general_ledger: UploadFile = File(..., description="CSV general ledger file"),
    session_id: str | None = None,
):
    # Validate bank statement file
    if not bank_statement.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Bank statement must be a CSV file")

    # Validate general ledger file
    if not general_ledger.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="General ledger must be a CSV file")

    try:
        # Read file contents
        bank_content = await bank_statement.read()
        gl_content = await general_ledger.read()

        # Process reconciliation using the enhanced agent
        reconciliation_result = reconciliation_agent.process_reconciliation(
            bank_content, gl_content, session_id
        )

        return {
            "message": "Reconciliation completed",
            "bank_statement_file": bank_statement.filename,
            "general_ledger_file": general_ledger.filename,
            "reconciliation": reconciliation_result,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error processing reconciliation: {str(e)}"
        ) from e


@app.get("/reconcile/session/{session_id}")
async def get_reconciliation_session(session_id: str):
    """Get reconciliation session details"""
    try:
        session = reconciliation_agent.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        return {
            "session_id": session.session_id,
            "agent_state": session.agent_state,
            "iteration_count": session.iteration_count,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "matches": [match.model_dump() for match in session.matches],
            "agent_thoughts": [
                thought.model_dump() for thought in session.agent_thoughts
            ],
            "user_feedback": session.user_feedback,
            "processing_notes": session.processing_notes,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error retrieving session: {str(e)}"
        ) from e


@app.post("/reconcile/session/{session_id}/match/{bank_index}/status")
async def update_match_status(
    session_id: str,
    bank_index: int,
    status: MatchStatus = Body(..., description="New match status"),
):
    """Update the status of a specific match"""
    try:
        success = reconciliation_agent.update_match_status(
            session_id, bank_index, status
        )
        if not success:
            raise HTTPException(status_code=404, detail="Match not found")

        return {
            "message": "Match status updated successfully",
            "session_id": session_id,
            "bank_index": bank_index,
            "status": status,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error updating match status: {str(e)}"
        ) from e


@app.get("/reconcile/session/{session_id}/match/{bank_index}/documents")
async def find_document_matches(session_id: str, bank_index: int):
    """Find document metadata that matches a bank entry"""
    try:
        matching_docs = reconciliation_agent.find_document_matches(
            session_id, bank_index
        )

        return {
            "session_id": session_id,
            "bank_index": bank_index,
            "matching_documents": matching_docs,
            "total_found": len(matching_docs),
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error finding document matches: {str(e)}"
        ) from e


@app.post("/reconcile/session/{session_id}/match/{bank_index}/link-document")
async def link_document_to_match(
    session_id: str,
    bank_index: int,
    document_path: str = Body(..., description="Path to the document to link"),
):
    """Link a document to a specific match"""
    try:
        session = reconciliation_agent.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Find the match and add the document to linked_documents
        for match in session.matches:
            if match.bank_index == bank_index:
                if document_path not in match.linked_documents:
                    match.linked_documents.append(document_path)
                    reconciliation_agent._save_session(session)

                return {
                    "message": "Document linked successfully",
                    "session_id": session_id,
                    "bank_index": bank_index,
                    "linked_documents": match.linked_documents,
                }

        raise HTTPException(status_code=404, detail="Match not found")
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error linking document: {str(e)}"
        ) from e


@app.post("/reconcile/session/{session_id}/continue")
async def continue_agent_processing(
    session_id: str,
    user_feedback: str | None = Body(None, description="User feedback for the agent"),
):
    """Continue the agent's processing based on current state and user feedback"""
    try:
        result = reconciliation_agent.continue_agent_processing(
            session_id, user_feedback
        )
        if "error" in result:
            raise HTTPException(status_code=404, detail=result["error"])

        return result
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error continuing agent processing: {str(e)}"
        ) from e


@app.post("/reconcile/session/{session_id}/finalize")
async def finalize_reconciliation(session_id: str):
    """Finalize reconciliation by processing all verified matches"""
    try:
        session = reconciliation_agent.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Get all verified matches
        verified_matches = [
            match for match in session.matches if match.status == MatchStatus.VERIFIED
        ]

        # Process verified matches (remove from working datasets)
        processed_count = 0
        for match in verified_matches:
            if match.gl_index is not None:
                # Mark as processed (in a real system, you'd update your database)
                processed_count += 1

        # Update session status
        session.agent_state = "completed"
        reconciliation_agent._save_session(session)

        return {
            "message": "Reconciliation finalized",
            "session_id": session_id,
            "processed_matches": processed_count,
            "total_verified": len(verified_matches),
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error finalizing reconciliation: {str(e)}"
        ) from e


@app.post("/process-document")
async def process_document(
    document: UploadFile = File(..., description="PDF document to process"),
):
    """Extract seller, customer, date, amount, invoice number, and description from PDF document"""
    # Validate document file
    if not document.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Document must be a PDF file")

    try:
        # Read file contents
        document_content = await document.read()

        # Process document using the processor
        extraction_result = document_processor.process_document(
            document_content, document.filename
        )

        return {
            "message": "Document processing completed",
            "filename": document.filename,
            "extraction": extraction_result.get("extraction"),
            "processing_notes": extraction_result.get("processing_notes"),
            "saved_to": extraction_result.get("saved_to"),
        }

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error processing document: {str(e)}"
        ) from e


@app.get("/scalar", include_in_schema=False)
async def scalar_html():
    return get_scalar_api_reference(
        openapi_url=app.openapi_url,
        title=app.title,
    )


for route in app.routes:
    if isinstance(route, APIRoute):
        route.operation_id = route.name
