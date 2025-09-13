import io
import json
import logging
import math
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

import pandas as pd
from openai import OpenAI
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class MatchStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    VERIFIED = "verified"


class AgentState(str, Enum):
    INITIAL_MATCHING = "initial_matching"
    USER_REVIEW = "user_review"
    DOCUMENT_LINKING = "document_linking"
    FINAL_VERIFICATION = "final_verification"
    ITERATIVE_PROCESSING = "iterative_processing"
    COMPLETED = "completed"


class BankMatchData(BaseModel):
    bank_index: int
    gl_indexes: list[int] = Field(
        default_factory=list
    )  # List of GL entries for transaction lifecycle
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str
    status: MatchStatus = MatchStatus.PENDING
    linked_documents: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.now)
    verified_at: datetime | None = None
    user_feedback: str | None = None


class AgentThought(BaseModel):
    step: str
    reasoning: str
    action: str
    confidence: float
    timestamp: datetime = Field(default_factory=datetime.now)


class ReconciliationSession(BaseModel):
    session_id: str
    bank_data: list[dict[str, Any]]
    gl_data: list[dict[str, Any]]
    matches: list[BankMatchData] = Field(default_factory=list)
    agent_state: AgentState = AgentState.INITIAL_MATCHING
    agent_thoughts: list[AgentThought] = Field(default_factory=list)
    user_feedback: list[dict[str, Any]] = Field(default_factory=list)
    iteration_count: int = 0
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    processing_notes: str = ""


class AIReconciliationResponse(BaseModel):
    bank_matches: list[BankMatchData]
    agent_state: AgentState
    agent_thoughts: list[AgentThought]
    processing_notes: str
    session_id: str
    next_action: str


class ReconciliationAgent:
    def __init__(self, openai_api_key: str):
        self.client = OpenAI(api_key=openai_api_key)
        self.sessions: dict[str, ReconciliationSession] = {}
        self.data_dir = Path("data")
        self.data_dir.mkdir(exist_ok=True)

    def _clean_nan_values(self, data: Any) -> Any:
        """Recursively clean NaN values from data structures for JSON serialization"""
        if isinstance(data, dict):
            return {key: self._clean_nan_values(value) for key, value in data.items()}
        elif isinstance(data, list):
            return [self._clean_nan_values(item) for item in data]
        elif isinstance(data, float):
            if math.isnan(data) or math.isinf(data):
                return 0.0
            return data
        else:
            return data

    def _think(
        self,
        session: ReconciliationSession,
        context: str,
        user_input: str | None = None,
    ) -> AgentThought:
        """The agent thinks about what to do next based on current state and context"""

        system_prompt = f"""You are an intelligent financial reconciliation agent. Your job is to help users reconcile bank statements with general ledger entries.

Current session state: {session.agent_state}
Iteration: {session.iteration_count}
Total bank entries: {len(session.bank_data)}
Total GL entries: {len(session.gl_data)}
Current matches: {len(session.matches)}

Previous thoughts:
{json.dumps([thought.model_dump() for thought in session.agent_thoughts[-3:]], indent=2, default=str)}

User feedback history:
{json.dumps(session.user_feedback[-3:], indent=2)}

Context: {context}

You must think step by step and decide what action to take next. Consider:
1. What is the current state of the reconciliation?
2. What are the highest priority tasks?
3. What would be most helpful for the user right now?
4. How can you improve the matching process?

Respond with your reasoning and the next action to take."""

        user_prompt = f"""Please analyze the current situation and decide what to do next.

{context}

{f"User input: {user_input}" if user_input else ""}

Think through this step by step and provide:
1. Your reasoning for what needs to be done
2. The specific action you want to take
3. Your confidence level (0-1) in this decision

Be specific and actionable in your response."""

        try:
            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.3,
            )

            content = response.choices[0].message.content
            logger.info(f"Agent thinking: {content}")

            # Parse the response to extract reasoning, action, and confidence
            reasoning = content
            action = "continue_processing"
            confidence = 0.8

            # Try to extract structured information from the response
            if "action:" in content.lower():
                parts = content.split("action:")
                if len(parts) > 1:
                    action = parts[1].strip().split("\n")[0].strip()

            if "confidence:" in content.lower():
                try:
                    conf_part = (
                        content.lower().split("confidence:")[1].strip().split()[0]
                    )
                    confidence = float(conf_part)
                    # Validate confidence value
                    if math.isnan(confidence) or math.isinf(confidence):
                        confidence = 0.8
                    confidence = max(0.0, min(1.0, confidence))  # Clamp between 0 and 1
                except Exception:
                    confidence = 0.8

            return AgentThought(
                step=f"iteration_{session.iteration_count}",
                reasoning=reasoning,
                action=action,
                confidence=confidence,
            )

        except Exception as e:
            logger.error(f"Error in agent thinking: {e}")
            return AgentThought(
                step=f"iteration_{session.iteration_count}",
                reasoning=f"Error in thinking process: {str(e)}",
                action="error_recovery",
                confidence=0.1,
            )

    def process_reconciliation(
        self,
        bank_statement_content: bytes,
        gl_content: bytes,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Start the agentic reconciliation process
        """
        try:
            # Parse CSV files
            bank_df = pd.read_csv(io.BytesIO(bank_statement_content))
            gl_df = pd.read_csv(io.BytesIO(gl_content))

            # Convert to list of dicts for easier processing
            bank_data = bank_df.to_dict("records")
            gl_data = gl_df.to_dict("records")

            # Create or retrieve session
            if not session_id:
                session_id = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

            session = ReconciliationSession(
                session_id=session_id, bank_data=bank_data, gl_data=gl_data
            )

            # Agent starts thinking about initial matching
            context = f"""Starting reconciliation process with:
            - {len(bank_data)} bank statement entries
            - {len(gl_data)} general ledger entries
            
            I need to analyze the data and find the best matches. Let me start by examining the data structure and identifying high-confidence matches first."""

            thought = self._think(session, context)
            session.agent_thoughts.append(thought)
            session.iteration_count += 1

            # Agent performs initial matching based on its thinking
            matches = self._agent_initial_matching(session, thought)
            session.matches = matches
            session.agent_state = AgentState.USER_REVIEW

            # Save session
            self.sessions[session_id] = session
            self._save_session(session)

            # Create response
            response = AIReconciliationResponse(
                bank_matches=matches,
                agent_state=session.agent_state,
                agent_thoughts=session.agent_thoughts,
                processing_notes=f"Agent analyzed {len(bank_data)} bank entries and {len(gl_data)} GL entries. Found {len([m for m in matches if len(m.gl_indexes) > 0])} potential matches for user review.",
                session_id=session_id,
                next_action="Present matches to user for review and approval",
            )

            return self._clean_nan_values(response.model_dump())

        except Exception as e:
            logger.error(f"Reconciliation error: {str(e)}")
            return self._build_error_result(str(e))

    def _agent_initial_matching(
        self, session: ReconciliationSession, thought: AgentThought
    ) -> list[BankMatchData]:
        """Agent performs intelligent initial matching based on its analysis"""

        # Create a detailed prompt for the AI to analyze and match entries
        bank_data_str = json.dumps(
            session.bank_data[:10], indent=2
        )  # Show first 10 entries
        gl_data_str = json.dumps(
            session.gl_data[:10], indent=2
        )  # Show first 10 entries

        prompt = f"""You are a financial reconciliation expert. Analyze the following bank statement and general ledger data to find matches.

Bank Statement Entries (showing first 10):
{bank_data_str}

General Ledger Entries (showing first 10):
{gl_data_str}

Your task is to match bank statement entries with general ledger entries. For each bank entry, find the best matching GL entries - note that a single bank transaction may correspond to multiple GL entries (debits/credits representing the transaction lifecycle).

Consider these factors for matching:
1. Amount (the sum of GL entries should match the bank amount, or individual entries may match)
2. Date proximity (within a few days is acceptable, especially for payments that may be processed with delays)
3. Description similarity (look for common keywords, vendor names, etc.)
4. Transaction patterns and business logic (e.g., an invoice payment might have multiple GL entries)

IMPORTANT: Payment Processing Delays
- Bank transactions often appear 1-3 days after GL entries are recorded
- A bank payment on Day 3 might correspond to a GL entry recorded on Day 1
- When amounts match and descriptions are similar, but dates are 1-3 days apart, provide a LOW CONFIDENCE match (0.3-0.6)
- This helps users identify potential matches that need manual review rather than leaving them completely unmatched

For each bank entry, provide:
- bank_index: the index of the bank entry (0-based)
- gl_indexes: array of GL entry indexes that together represent this transaction, or empty array if no match
- confidence: your confidence in this match (0.0 to 1.0)
  * 0.9-1.0: Perfect match (exact amount, same date, clear description match)
  * 0.7-0.8: High confidence (amount matches, same date, good description similarity)
  * 0.5-0.6: Medium confidence (amount matches, date within 1-2 days, some description similarity)
  * 0.3-0.4: Low confidence (amount matches, date within 2-3 days, weak description similarity)
  * 0.0-0.2: Very low confidence or no match
- reasoning: brief explanation of why these GL entries match this bank entry

Examples of multi-entry matches:
- A $1000 payment might match GL entries for $800 invoice + $200 tax
- A deposit might match multiple revenue entries
- An expense might match cost + tax entries

Examples of temporal discrepancies (provide low confidence matches):
- Bank entry on 01/13/2025 for $1000 "Kings Inc. E-Trans" might match GL entry on 01/12/2025 for $1000 "Paid by Kings Inc."
- Bank entry on 01/15/2025 for $500 "ABC Corp Payment" might match GL entry on 01/13/2025 for $500 "ABC Corp Invoice"

Focus on providing low confidence matches for temporal discrepancies rather than leaving them unmatched.

Return your analysis as a JSON array of match objects."""

        try:
            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system",
                        "content": "You are a financial reconciliation expert. Analyze bank and GL data to find matches. Pay special attention to temporal discrepancies where bank transactions may appear 1-3 days after GL entries. Provide low confidence matches for these cases rather than leaving them unmatched. Return structured JSON with your analysis.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
            )

            content = response.choices[0].message.content
            logger.info(f"Agent matching analysis: {content}")

            # Try to extract JSON from the response
            try:
                # Look for JSON array in the response
                start_idx = content.find("[")
                end_idx = content.rfind("]") + 1
                if start_idx != -1 and end_idx != -1:
                    json_str = content[start_idx:end_idx]
                    matches_data = json.loads(json_str)
                else:
                    # Fallback: try to parse the entire response
                    matches_data = json.loads(content)
            except json.JSONDecodeError:
                # If JSON parsing fails, create a basic response
                matches_data = []
                for i in range(min(len(session.bank_data), 10)):
                    matches_data.append(
                        {
                            "bank_index": i,
                            "gl_indexes": [],
                            "confidence": 0.0,
                            "reasoning": "Could not parse agent response, manual review needed",
                        }
                    )

            # Convert to BankMatchData objects
            matches = []
            for match_data in matches_data:
                # Ensure confidence is a valid number
                confidence = match_data.get("confidence", 0.0)
                if (
                    not isinstance(confidence, (int, float))
                    or math.isnan(confidence)
                    or math.isinf(confidence)
                ):
                    confidence = 0.0
                confidence = max(0.0, min(1.0, confidence))  # Clamp between 0 and 1

                gl_indexes = match_data.get("gl_indexes", [])
                # Handle backward compatibility with old gl_index field
                if (
                    not gl_indexes
                    and "gl_index" in match_data
                    and match_data["gl_index"] is not None
                ):
                    gl_indexes = [match_data["gl_index"]]

                matches.append(
                    BankMatchData(
                        bank_index=match_data.get("bank_index", 0),
                        gl_indexes=gl_indexes,
                        confidence=confidence,
                        reasoning=match_data.get("reasoning", "No reasoning provided"),
                    )
                )

            return matches

        except Exception as e:
            logger.error(f"Error in agent matching: {e}")
            # Return empty matches if agent fails
            return []

    def continue_agent_processing(
        self, session_id: str, user_feedback: str | None = None
    ) -> dict[str, Any]:
        """Continue the agent's processing based on current state and user feedback"""
        session = self.sessions.get(session_id)
        if not session:
            return {"error": "Session not found"}

        # Add user feedback to session
        if user_feedback:
            session.user_feedback.append(
                {
                    "timestamp": datetime.now().isoformat(),
                    "feedback": user_feedback,
                    "iteration": session.iteration_count,
                }
            )

        # Agent thinks about next steps
        context = f"""Current state: {session.agent_state}
        User feedback: {user_feedback or "No new feedback"}
        Current matches: {len(session.matches)}
        Approved matches: {len([m for m in session.matches if m.status == MatchStatus.APPROVED])}
        Rejected matches: {len([m for m in session.matches if m.status == MatchStatus.REJECTED])}
        
        What should I do next?"""

        thought = self._think(session, context, user_feedback)
        session.agent_thoughts.append(thought)
        session.iteration_count += 1

        # Execute the agent's decision
        next_action = self._execute_agent_action(session, thought)

        # Update session
        session.updated_at = datetime.now()
        self._save_session(session)

        # Clean NaN values before returning
        result = {
            "session_id": session_id,
            "agent_state": session.agent_state,
            "agent_thoughts": [
                thought.model_dump() for thought in session.agent_thoughts
            ],
            "next_action": next_action,
            "matches": [match.model_dump() for match in session.matches],
        }

        return self._clean_nan_values(result)

    def _execute_agent_action(
        self, session: ReconciliationSession, thought: AgentThought
    ) -> str:
        """Execute the action decided by the agent"""
        action = thought.action.lower()

        if "document" in action and session.agent_state == AgentState.USER_REVIEW:
            # Agent wants to find documents for approved matches
            session.agent_state = AgentState.DOCUMENT_LINKING
            return "Finding supporting documents for approved matches"

        elif "verify" in action and session.agent_state == AgentState.DOCUMENT_LINKING:
            # Agent wants to verify document links
            session.agent_state = AgentState.FINAL_VERIFICATION
            return "Presenting document links for final verification"

        elif "iterate" in action or "continue" in action:
            # Agent wants to continue with harder cases
            session.agent_state = AgentState.ITERATIVE_PROCESSING
            return "Processing remaining unmatched entries with advanced techniques"

        elif "complete" in action:
            # Agent thinks reconciliation is complete
            session.agent_state = AgentState.COMPLETED
            return "Reconciliation process completed"

        else:
            # Default action
            return f"Agent decided: {thought.action}"

    def _extract_amount(self, entry: dict) -> float | None:
        """Extract amount from entry, trying common field names"""
        amount_fields = ["amount", "value", "total", "debit", "credit", "balance"]

        for field in amount_fields:
            if field in entry and entry[field] is not None:
                try:
                    # Handle string values with currency symbols
                    value = str(entry[field]).replace("$", "").replace(",", "").strip()
                    return float(value)
                except (ValueError, TypeError):
                    continue

        # Try to find any numeric field
        for value in entry.values():
            if isinstance(value, (int, float)) and value != 0:
                return float(value)

        return None

    def _extract_date(self, entry: dict) -> datetime | None:
        """Extract date from entry, trying common field names"""
        date_fields = ["date", "transaction_date", "posting_date", "value_date"]

        for field in date_fields:
            if field in entry and entry[field] is not None:
                try:
                    return pd.to_datetime(entry[field]).to_pydatetime()
                except (ValueError, TypeError):
                    continue

        return None

    def _save_session(self, session: ReconciliationSession) -> None:
        """Save session to file"""
        session_file = self.data_dir / f"{session.session_id}.json"
        session_data = session.model_dump()
        cleaned_data = self._clean_nan_values(session_data)
        with open(session_file, "w", encoding="utf-8") as f:
            json.dump(cleaned_data, f, indent=2, default=str)

    def get_session(self, session_id: str) -> ReconciliationSession | None:
        """Retrieve session by ID"""
        print(f"🔍 Getting session: {session_id}")
        
        # First check in-memory sessions
        if session_id in self.sessions:
            print(f"✅ Found session {session_id} in memory")
            return self.sessions[session_id]
        
        # If not in memory, try to load from file
        try:
            session_file = self.data_dir / f"{session_id}.json"
            print(f"📁 Looking for session file: {session_file}")
            
            if not session_file.exists():
                # Try the old naming convention with double prefix
                old_session_file = self.data_dir / f"session_{session_id}.json"
                print(f"📁 Trying old naming convention: {old_session_file}")
                if old_session_file.exists():
                    session_file = old_session_file
                    print(f"✅ Found session file with old naming: {session_file}")
            
            if session_file.exists():
                print(f"📖 Loading session from file: {session_file}")
                with open(session_file, encoding="utf-8") as f:
                    session_data = json.load(f)
                
                print(f"📊 Session data loaded: {len(session_data.get('bank_matches', []))} matches")
                
                # Reconstruct the session object from file data
                session = ReconciliationSession(**session_data)
                # Store it in memory for future access
                self.sessions[session_id] = session
                print(f"✅ Session {session_id} loaded and stored in memory")
                return session
            else:
                print(f"❌ Session file not found: {session_file}")
        except Exception as e:
            print(f"❌ Error loading session {session_id} from file: {e}")
            logger.warning(f"Error loading session {session_id} from file: {e}")
        
        print(f"❌ Session {session_id} not found")
        return None

    def update_match_status(
        self, session_id: str, bank_index: int, status: MatchStatus
    ) -> bool:
        """Update match status for a specific bank entry and trigger document search if approved"""
        session = self.sessions.get(session_id)
        if not session:
            return False

        for match in session.matches:
            if match.bank_index == bank_index:
                match.status = status
                if status == MatchStatus.VERIFIED:
                    match.verified_at = datetime.now()

                # If match is approved, automatically search for supporting documents
                if status == MatchStatus.APPROVED:
                    matching_docs = self.find_document_matches(session_id, bank_index)
                    if matching_docs:
                        # Store document matches in the match record
                        match.linked_documents = [
                            doc["file_path"] for doc in matching_docs
                        ]
                        logger.info(
                            f"Found {len(matching_docs)} document matches for bank_index {bank_index}"
                        )
                    else:
                        logger.info(
                            f"No document matches found for bank_index {bank_index}"
                        )

                session.updated_at = datetime.now()
                self._save_session(session)
                return True

        return False

    def find_document_matches(self, session_id: str, bank_index: int) -> list[dict]:
        """Find document metadata that matches a bank entry"""
        session = self.sessions.get(session_id)
        if not session:
            return []

        bank_entry = session.bank_data[bank_index]
        bank_amount = self._extract_amount(bank_entry)
        bank_date = self._extract_date(bank_entry)

        matching_docs = []

        # Search through document metadata in data/meta/*.json
        meta_dir = self.data_dir / "meta"
        if not meta_dir.exists():
            return []

        for doc_file in meta_dir.glob("*.json"):
            try:
                with open(doc_file, encoding="utf-8") as f:
                    doc_data = json.load(f)

                extraction = doc_data.get("extraction", {})
                doc_amount = extraction.get("amount", 0)
                doc_date_str = extraction.get("date", "")

                # Check amount match (exact or very close)
                amount_match = False
                if bank_amount and doc_amount and abs(bank_amount - doc_amount) < 0.01:
                    amount_match = True

                # Check date match (within 7 days)
                date_match = False
                if bank_date and doc_date_str:
                    try:
                        doc_date = pd.to_datetime(doc_date_str).to_pydatetime()
                        if abs((bank_date - doc_date).days) <= 7:
                            date_match = True
                    except Exception:
                        pass

                # Calculate confidence based on matches
                confidence = 0.0
                match_reasons = []

                if amount_match and date_match:
                    confidence = 0.95
                    match_reasons = ["amount", "date"]
                elif amount_match:
                    confidence = 0.8
                    match_reasons = ["amount"]
                elif date_match:
                    confidence = 0.4
                    match_reasons = ["date"]

                if confidence > 0:
                    matching_docs.append(
                        {
                            "file_path": str(doc_file),
                            "filename": doc_data.get("original_filename", ""),
                            "extraction": extraction,
                            "match_reasons": match_reasons,
                            "confidence": confidence,
                        }
                    )

            except Exception as e:
                logger.warning(f"Error reading document file {doc_file}: {e}")
                continue

        return sorted(matching_docs, key=lambda x: x["confidence"], reverse=True)

    def get_match_documents(self, session_id: str, bank_index: int) -> list[dict]:
        """Get detailed document information for a specific match"""
        session = self.sessions.get(session_id)
        if not session:
            return []

        # Find the match for this bank index
        match = None
        for m in session.matches:
            if m.bank_index == bank_index:
                match = m
                break

        if not match or not match.linked_documents:
            # If no documents are linked yet, try to find them
            return self.find_document_matches(session_id, bank_index)

        # Return detailed information about linked documents
        detailed_docs = []
        meta_dir = self.data_dir / "meta"

        for doc_path in match.linked_documents:
            try:
                doc_file = Path(doc_path)
                if doc_file.exists():
                    with open(doc_file, encoding="utf-8") as f:
                        doc_data = json.load(f)

                    detailed_docs.append(
                        {
                            "file_path": str(doc_file),
                            "filename": doc_data.get("original_filename", ""),
                            "extraction": doc_data.get("extraction", {}),
                            "timestamp": doc_data.get("timestamp", ""),
                            "processing_notes": doc_data.get("processing_notes", ""),
                        }
                    )
            except Exception as e:
                logger.warning(f"Error reading linked document {doc_path}: {e}")
                continue

        return detailed_docs

    def _build_error_result(self, error_message: str) -> dict[str, Any]:
        """Build error result structure"""
        return {"bank_matches": [], "error": error_message, "session_id": None}

    def create_manual_match(
        self, session_id: str, bank_index: int, gl_indexes: list[int], explanation: str
    ) -> dict[str, Any]:
        """Create a manual match between bank and GL entries"""
        print(f"🔧 Creating manual match for session {session_id}: Bank {bank_index} -> GL {gl_indexes}")
        
        try:
            # Load session data - try both naming conventions for backward compatibility
            session_file = self.data_dir / f"{session_id}.json"
            print(f"📁 Looking for session file: {session_file}")
            
            if not session_file.exists():
                # Try the old naming convention with double prefix
                old_session_file = self.data_dir / f"session_{session_id}.json"
                print(f"📁 Trying old naming convention: {old_session_file}")
                if old_session_file.exists():
                    session_file = old_session_file
                    print(f"✅ Found session file with old naming: {session_file}")
                else:
                    print(f"❌ Session file not found: {session_file} or {old_session_file}")
                    raise ValueError(f"Session {session_id} not found")

            print(f"📖 Loading session from file: {session_file}")
            with open(session_file, encoding="utf-8") as f:
                session_data = json.load(f)
            
            print(f"📊 Session data loaded: {len(session_data.get('bank_matches', []))} existing matches")

            # Check if manual match already exists
            existing_match = next(
                (
                    match
                    for match in session_data.get("bank_matches", [])
                    if match.get("bank_index") == bank_index
                ),
                None,
            )

            if existing_match:
                raise ValueError("A match already exists for this bank entry")

            # Create new manual match
            new_match = {
                "bank_index": bank_index,
                "gl_indexes": gl_indexes,
                "confidence": 1.0,  # Manual matches have 100% confidence
                "reasoning": f"Manual match created by user: {explanation}",
                "status": "approved",
                "linked_documents": [],
                "created_at": datetime.now().isoformat(),
                "verified_at": datetime.now().isoformat(),
                "user_feedback": explanation,
            }

            # Add the new match to the session
            if "bank_matches" not in session_data:
                session_data["bank_matches"] = []
            session_data["bank_matches"].append(new_match)

            # Update session metadata
            session_data["last_updated"] = datetime.now().isoformat()
            session_data["manual_matches_count"] = (
                session_data.get("manual_matches_count", 0) + 1
            )

            # Save updated session data
            with open(session_file, "w", encoding="utf-8") as f:
                json.dump(session_data, f, indent=2, ensure_ascii=False)

            # Update in-memory session if it exists
            if session_id in self.sessions:
                print(f"🔄 Updating in-memory session {session_id} with new manual match")
                # Ensure the session_data has the correct structure for ReconciliationSession
                if "bank_matches" in session_data and "matches" not in session_data:
                    session_data["matches"] = session_data["bank_matches"]
                # Reload the session from file to ensure consistency
                updated_session = ReconciliationSession(**session_data)
                self.sessions[session_id] = updated_session
                print(f"✅ In-memory session {session_id} updated with {len(updated_session.matches)} matches")

            logger.info(
                f"Created manual match for session {session_id}: Bank #{bank_index} -> GL {gl_indexes}"
            )

            return new_match

        except Exception as e:
            logger.error(f"Error creating manual match: {str(e)}")
            raise e

    def save_session(self, session_id: str, session_data: dict, change_description: str) -> dict[str, Any]:
        """Save the entire session data with change description"""
        print(f"💾 Saving session {session_id} with change: {change_description}")
        
        try:
            # Update session metadata
            session_data["last_updated"] = datetime.now().isoformat()
            session_data["change_description"] = change_description
            
            # Clean NaN values before saving
            cleaned_session_data = self._clean_nan_values(session_data)
            
            # Save to file
            session_file = self.data_dir / f"{session_id}.json"
            with open(session_file, "w", encoding="utf-8") as f:
                json.dump(cleaned_session_data, f, indent=2, ensure_ascii=False)
            
            # Update in-memory session if it exists
            if session_id in self.sessions:
                print(f"🔄 Updating in-memory session {session_id}")
                updated_session = ReconciliationSession(**cleaned_session_data)
                self.sessions[session_id] = updated_session
                print(f"✅ In-memory session {session_id} updated with {len(updated_session.matches)} matches")
            
            logger.info(f"Saved session {session_id} with {len(session_data.get('bank_matches', []))} matches")
            
            return {
                "session_id": session_id,
                "matches_count": len(session_data.get("bank_matches", [])),
                "saved_at": session_data["last_updated"]
            }
            
        except Exception as e:
            logger.error(f"Error saving session: {str(e)}")
            raise e
