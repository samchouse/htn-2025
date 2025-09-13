import os

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.routing import APIRoute
from reconciliation_agent import ReconciliationAgent
from scalar_fastapi import get_scalar_api_reference

app = FastAPI(title="Reconciliation API", version="1.0.0")

# Initialize reconciliation agent
openai_api_key = os.getenv("OPENAI_API_KEY")
if not openai_api_key:
    raise ValueError("OPENAI_API_KEY environment variable is required")

reconciliation_agent = ReconciliationAgent(openai_api_key)


@app.post("/reconcile")
async def reconcile_files(
    bank_statement: UploadFile = File(..., description="CSV bank statement file"),
    general_ledger: UploadFile = File(..., description="CSV general ledger file"),
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

        # Process reconciliation using the agent
        reconciliation_result = reconciliation_agent.process_reconciliation(
            bank_content, gl_content
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


@app.get("/scalar", include_in_schema=False)
async def scalar_html():
    return get_scalar_api_reference(
        openapi_url=app.openapi_url,
        title=app.title,
    )


for route in app.routes:
    if isinstance(route, APIRoute):
        route.operation_id = route.name
