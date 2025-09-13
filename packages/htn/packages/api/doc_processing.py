import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF
from openai import OpenAI
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class DocumentExtractionData(BaseModel):
    seller: str = Field(description="The name of the seller/vendor")
    customer: str = Field(description="The name of the customer/buyer")
    date: str = Field(description="The document date in YYYY-MM-DD format")
    amount: float = Field(description="The total amount as a number")
    invoice_number: str = Field(description="The invoice or document number")
    description: str = Field(
        description="A short description of what the document is for"
    )

    class Config:
        extra = "forbid"  # This ensures additionalProperties: false


class DocumentProcessingResponse(BaseModel):
    extraction: DocumentExtractionData
    processing_notes: str


class DocumentProcessor:
    def __init__(self, openai_api_key: str):
        self.client = OpenAI(api_key=openai_api_key)
        self.data_dir = Path("data")
        self.data_dir.mkdir(exist_ok=True)

    def process_document(
        self, pdf_content: bytes, filename: str = "document.pdf"
    ) -> dict[str, Any]:
        """
        Process PDF document to extract seller, customer, date, amount, invoice number, and description
        """
        self._save_original_pdf(pdf_content, filename)

        try:
            # Extract text from PDF
            pdf_text = self._extract_text_from_pdf(pdf_content)
            logger.info(f"Extracted text from PDF: {len(pdf_text)} characters")

            if not pdf_text.strip():
                raise Exception("No text could be extracted from the PDF")

            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system",
                        "content": """You are a document extraction expert. Extract the following information from the provided PDF document text:
                        - seller: The name of the seller/vendor
                        - customer: The name of the customer/buyer
                        - date: The document date (format as YYYY-MM-DD)
                        - amount: The total amount as a number (float)
                        - invoice_number: The invoice or document number
                        - description: A short description of what the document is for
                        
                        You must return the data in the exact JSON schema format specified.
                        If any information is not available, use "N/A" for text fields and 0.0 for amount.
                        """,
                    },
                    {
                        "role": "user",
                        "content": f"""Please extract the document information from the following PDF text according to the schema. Return only valid JSON that matches this structure:

{{
  "seller": "string",
  "customer": "string", 
  "date": "string (YYYY-MM-DD format)",
  "amount": number,
  "invoice_number": "string",
  "description": "string"
}}

If information is not found, use "N/A" for text fields and 0.0 for amount.

PDF Text:
{pdf_text}""",
                    },
                ],
                temperature=0.1,
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "document_extraction",
                        "schema": DocumentExtractionData.model_json_schema(),
                        "strict": True,
                    },
                },
            )

            # Parse the structured response
            content = response.choices[0].message.content
            logger.info(f"OpenAI response: {content}")

            # Parse the JSON response (should be valid due to structured output)
            try:
                extracted_data = json.loads(content)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse structured response: {e}")
                # Fallback to text extraction if structured output fails
                extracted_data = self._extract_from_text(content)

            # Validate and structure the response
            extraction_data = DocumentExtractionData(**extracted_data)
            result = DocumentProcessingResponse(
                extraction=extraction_data,
                processing_notes=f"Successfully processed document: {filename}",
            )

            # Save the result to file
            saved_file_path = self._save_extraction_result(result, filename)

            # Add the file path to the result
            result_dict = result.model_dump()
            result_dict["saved_to"] = str(saved_file_path)

            return result_dict

        except Exception as e:
            logger.error(f"Document processing error: {str(e)}")
            return self._build_error_result(str(e))

    def _save_original_pdf(self, pdf_content: bytes, filename: str) -> Path:
        """Save the original PDF file to the data directory"""
        try:
            # Create the PDF storage directory
            pdf_dir = self.data_dir / "meta"
            pdf_dir.mkdir(exist_ok=True)

            # Generate unique filename with timestamp to avoid conflicts
            base_name = Path(filename).stem
            extension = Path(filename).suffix or ".pdf"
            unique_filename = f"{base_name}{extension}"

            file_path = pdf_dir / unique_filename

            # Write the PDF content to file
            with open(file_path, "wb") as f:
                f.write(pdf_content)

            logger.info(f"Original PDF saved to: {file_path}")
            return file_path

        except Exception as e:
            logger.error(f"Error saving original PDF: {str(e)}")
            # Don't raise an exception here as this is not critical for processing
            return None

    def _extract_text_from_pdf(self, pdf_content: bytes) -> str:
        """Extract text from PDF content using PyMuPDF"""
        try:
            # Open PDF from bytes
            doc = fitz.open(stream=pdf_content, filetype="pdf")
            text = ""

            # Extract text from all pages
            for page_num in range(doc.page_count):
                page = doc[page_num]
                text += page.get_text() + "\n"

            doc.close()
            return text.strip()
        except Exception as e:
            logger.error(f"Error extracting text from PDF: {str(e)}")
            raise Exception(f"Failed to extract text from PDF: {str(e)}") from e

    def _extract_from_text(self, text: str) -> dict[str, Any]:
        """Fallback method to extract data from unstructured text response"""
        lines = text.split("\n")
        data = {
            "seller": "N/A",
            "customer": "N/A",
            "date": "N/A",
            "amount": 0.0,
            "invoice_number": "N/A",
            "description": "N/A",
        }

        for line in lines:
            line_lower = line.lower()
            if "seller" in line_lower or "vendor" in line_lower:
                data["seller"] = line.split(":", 1)[-1].strip()
            elif "customer" in line_lower or "buyer" in line_lower:
                data["customer"] = line.split(":", 1)[-1].strip()
            elif "date" in line_lower:
                data["date"] = line.split(":", 1)[-1].strip()
            elif "amount" in line_lower or "total" in line_lower:
                try:
                    # Extract numeric value
                    amount_match = re.search(r"[\d,]+\.?\d*", line)
                    if amount_match:
                        data["amount"] = float(amount_match.group().replace(",", ""))
                except ValueError:
                    pass
            elif "invoice" in line_lower or "number" in line_lower:
                data["invoice_number"] = line.split(":", 1)[-1].strip()
            elif "description" in line_lower:
                data["description"] = line.split(":", 1)[-1].strip()

        return data

    def _save_extraction_result(
        self, result: DocumentProcessingResponse, original_filename: str
    ) -> Path:
        """Save extraction result to JSON file in data directory"""
        # Generate unique filename with timestamp
        filename = f"{Path(original_filename).name}.json"
        file_path = self.data_dir / "meta" / filename

        # Prepare data to save
        save_data = {
            "timestamp": datetime.now().isoformat(),
            "original_filename": original_filename,
            "extraction": result.extraction.model_dump(),
            "processing_notes": result.processing_notes,
        }

        # Write to file
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(save_data, f, indent=2, ensure_ascii=False)

        logger.info(f"Extraction result saved to: {file_path}")
        return file_path

    def _build_error_result(self, error_message: str) -> dict[str, Any]:
        """Build error response"""
        return {
            "extraction": {
                "seller": "N/A",
                "customer": "N/A",
                "date": "N/A",
                "amount": 0.0,
                "invoice_number": "N/A",
                "description": "N/A",
            },
            "processing_notes": f"Error processing document: {error_message}",
            "saved_to": None,
        }
