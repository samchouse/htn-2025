import os
from pathlib import Path

from doc_processing import DocumentProcessor
from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
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
    print(f"🔍 GET /reconcile/session/{session_id}")
    try:
        session = reconciliation_agent.get_session(session_id)
        if not session:
            print(f"❌ Session {session_id} not found")
            raise HTTPException(status_code=404, detail="Session not found")
        
        print(f"✅ Session {session_id} found with {len(session.matches)} matches")

        result = {
            "session_id": session.session_id,
            "agent_state": session.agent_state,
            "iteration_count": session.iteration_count,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "matches": [match.model_dump() for match in session.matches],
            "bank_matches": [match.model_dump() for match in session.matches],  # Also include as bank_matches for frontend compatibility
            "agent_thoughts": [
                thought.model_dump() for thought in session.agent_thoughts
            ],
            "user_feedback": session.user_feedback,
            "processing_notes": session.processing_notes,
            "bank_data": session.bank_data,
            "gl_data": session.gl_data,
        }

        # Clean NaN values before returning
        return reconciliation_agent._clean_nan_values(result)
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
async def get_match_documents(session_id: str, bank_index: int):
    """Get document metadata that matches a bank entry (linked or found)"""
    try:
        matching_docs = reconciliation_agent.get_match_documents(session_id, bank_index)

        return {
            "session_id": session_id,
            "bank_index": bank_index,
            "matching_documents": matching_docs,
            "total_found": len(matching_docs),
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error getting document matches: {str(e)}"
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
                    "gl_indexes": match.gl_indexes,
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
            if len(match.gl_indexes) > 0:
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

@app.get("/download-document")
async def download_document(path: str):
    """Download a document file from the data directory"""
    try:
        # Security check: ensure the path is within the data directory
        requested_path = Path(path)
        data_dir = Path("data")

        # Convert to absolute paths for security check
        abs_data_dir = data_dir.resolve()

        # If path is relative, make it relative to data dir
        if not requested_path.is_absolute():
            abs_file_path = (abs_data_dir / requested_path).resolve()
        else:
            abs_file_path = requested_path.resolve()

        # Security check: ensure file is within data directory
        try:
            abs_file_path.relative_to(abs_data_dir)
        except ValueError:
            raise HTTPException(
                status_code=403, detail="Access denied: file outside allowed directory"
            ) from ValueError

        # Check if file exists
        if not abs_file_path.exists():
            raise HTTPException(status_code=404, detail="File not found")

        # Check if it's a file (not directory)
        if not abs_file_path.is_file():
            raise HTTPException(status_code=404, detail="Path is not a file")

        # Return the file
        filename = abs_file_path.name
        return FileResponse(
            path=str(abs_file_path), filename=filename, media_type="application/pdf"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error serving file: {str(e)}") from e

@app.post("/reconcile/session/{session_id}/save")
async def save_session(
    session_id: str,
    session_data: dict = Body(...),
):
    """Save the entire session with change description"""
    print(f"💾 POST /reconcile/session/{session_id}/save")
    print(f"📥 Session data received with {len(session_data.get('bank_matches', []))} matches")
    try:
        change_description = session_data.get("change_description", "Session updated")
        
        # Save session using the reconciliation agent
        print("🔄 Calling reconciliation_agent.save_session...")
        reconciliation_agent.save_session(session_id, session_data, change_description)
        print("✅ Session saved successfully")

        return {
            "message": "Session saved successfully",
            "session_id": session_id,
            "matches_count": len(session_data.get("bank_matches", [])),
        }

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error saving session: {str(e)}"
        ) from e


@app.post("/reconcile/session/{session_id}/manual-match")
async def create_manual_match(
    session_id: str,
    manual_match_data: dict = Body(...),
):
    """Create a manual match between bank and GL entries"""
    print(f"🔧 POST /reconcile/session/{session_id}/manual-match")
    print(f"📥 Manual match data received: {manual_match_data}")
    try:
        bank_index = manual_match_data.get("bank_index")
        gl_indexes = manual_match_data.get("gl_indexes")
        explanation = manual_match_data.get("explanation")

        if bank_index is None:
            raise HTTPException(status_code=400, detail="bank_index is required")

        if not gl_indexes or not isinstance(gl_indexes, list) or len(gl_indexes) == 0:
            raise HTTPException(
                status_code=400, detail="gl_indexes must be a non-empty array"
            )

        if not explanation or not isinstance(explanation, str) or not explanation.strip():
            raise HTTPException(status_code=400, detail="explanation is required")

        # Create manual match using the reconciliation agent
        print("🔄 Calling reconciliation_agent.create_manual_match...")
        result = reconciliation_agent.create_manual_match(
            session_id, bank_index, gl_indexes, explanation
        )
        print(f"✅ Manual match created successfully: {result}")

        return {
            "message": "Manual match created successfully",
            "match": result,
            "session_updated": True,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error creating manual match: {str(e)}"
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
