"""
Thin wrapper around the Anthropic API.
All agents use this - forces JSON output and validates against Pydantic models.
"""

import json
import logging
import os
from typing import TypeVar, Type
from pydantic import BaseModel, ValidationError
import anthropic

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# Single shared client
_client: anthropic.Anthropic | None = None


def get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not set in environment")
        _client = anthropic.Anthropic(api_key=api_key)
    return _client


SYSTEM_JSON = """You are a financial analysis engine. You MUST respond with valid JSON only.
No markdown, no backticks, no explanation outside the JSON structure.
All numbers must be proper floats (not strings). Follow the exact schema provided."""


def call_llm_structured(
    prompt: str,
    schema_model: Type[T],
    system_extra: str = "",
    max_tokens: int = 2000,
) -> T:
    """
    Call Claude, expect JSON, parse + validate against Pydantic model.
    Raises ValueError if output doesn't match schema after 2 attempts.
    """
    client = get_client()
    system = SYSTEM_JSON + ("\n\n" + system_extra if system_extra else "")

    schema_hint = f"\n\nRespond with JSON matching this exact structure:\n{json.dumps(schema_model.model_json_schema(), indent=2)}"
    full_prompt = prompt + schema_hint

    for attempt in range(2):
        try:
            response = client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": full_prompt}],
            )
            raw = response.content[0].text.strip()

            # Strip accidental markdown fences
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
                raw = raw.strip()

            parsed = json.loads(raw)
            validated = schema_model.model_validate(parsed)
            logger.info(f"LLM call succeeded ({schema_model.__name__})")
            return validated

        except (json.JSONDecodeError, ValidationError) as e:
            logger.warning(f"Attempt {attempt + 1} failed: {e}")
            if attempt == 1:
                raise ValueError(f"LLM failed to produce valid {schema_model.__name__} after 2 attempts: {e}")
            # Add error context to retry
            full_prompt += f"\n\nPrevious attempt failed validation: {e}. Fix and retry."
