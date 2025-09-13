import io
import json
import logging
from typing import Any

import pandas as pd
from openai import OpenAI
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class BankMatchData(BaseModel):
    bank_index: int
    gl_index: int | None  # None if no match found
    confidence: float


class AIReconciliationResponse(BaseModel):
    bank_matches: list[BankMatchData]


class ReconciliationAgent:
    def __init__(self, openai_api_key: str):
        self.client = OpenAI(api_key=openai_api_key)

    def process_reconciliation(
        self, bank_statement_content: bytes, gl_content: bytes
    ) -> dict[str, Any]:
        """
        Process bank statement and GL reconciliation
        """
        try:
            # Parse CSV files
            bank_df = pd.read_csv(io.BytesIO(bank_statement_content))
            gl_df = pd.read_csv(io.BytesIO(gl_content))

            print(bank_df.iloc[0:20])

            response = self.client.responses.parse(
                model="gpt-4o",
                instructions="""
            You are a financial reconciliation expert. Your task is to match bank statement entries with general ledger entries.

            Rules:
            1. Go through each bank statement entry (row by row)
            2. For each bank entry, find the best matching GL entry or return None if no good match
            3. Look for matches based on:
               - Amount (exact match preferred)
               - Date (within reasonable range)
               - Description/reference (similar text patterns)
            4. Return confidence score for each match (0-1)
            5. Only match one GL entry per bank entry (first pass simplicity)

            For each bank statement entry, provide:
            - bank_index: index of bank statement entry (0-based)
            - gl_index: index of matching GL entry or null if no match
            - confidence: 0-1 confidence score
            - notes: brief explanation of match or why no match

            Return processing_notes about the overall reconciliation process.
            Even if there are less GL entries than bank entries, process all bank entries.
            """,
                input=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": "You will be provided with two CSV files: a bank statement and a general ledger. Reconcile the entries as per the instructions.",
                            },
                            {
                                "type": "input_text",
                                "text": "bank_statement.csv\n"
                                + json.dumps(bank_df.to_dict()),
                            },
                            {
                                "type": "input_text",
                                "text": "general_ledger.csv\n"
                                + json.dumps(gl_df.to_dict()),
                            },
                        ],
                    }
                ],
                text_format=AIReconciliationResponse,
            )

            # Process AI response into structured format
            ai_result = response.output_parsed
            print(ai_result)

            return ai_result.model_dump()

        except Exception as e:
            logger.error(f"Reconciliation error: {str(e)}")
            return self._build_error_result(str(e))
