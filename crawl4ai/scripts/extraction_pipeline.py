#!/usr/bin/env python3
"""
Crawl4AI extraction pipeline - Three approaches using hosted service:
1. Generate schema with LLM (one-time) then use CSS extraction (most efficient)
2. Manual CSS/JSON schema extraction
3. Direct LLM extraction (for complex/irregular content)

Usage examples:
  Generate schema: python extraction_pipeline.py --generate-schema <url> "<instruction>"
  Use generated schema: python extraction_pipeline.py --use-schema <url> schema.json
  Manual CSS: python extraction_pipeline.py --manual <url>
  Direct LLM: python extraction_pipeline.py --llm <url> "<instruction>"
"""

import asyncio
import sys
import json
from pathlib import Path

# Add current directory to path for importing crawl_service
sys.path.insert(0, str(Path(__file__).resolve().parent))
from crawl_service import crawl_url

# =============================================================================
# APPROACH 1: Generate Schema (Most Efficient for Repetitive Patterns)
# =============================================================================

async def generate_schema(url: str, instruction: str, output_file: str = "generated_schema.json"):
    """
    Step 1: Generate a reusable schema using LLM (one-time cost)
    Best for: E-commerce sites, blogs, news sites with repetitive patterns
    """
    print("🔍 Generating extraction schema using LLM...")

    extraction_strategy = {
        "type": "LLMExtractionStrategy",
        "params": {
            "provider": "openai/gpt-4o-mini",
            "instruction": f"""
            Analyze this webpage and generate a CSS/JSON extraction schema.
            Task: {instruction}

            Return a JSON schema with CSS selectors that can extract the required data.
            Format:
            {{
                "name": "items",
                "selector": "main_container_selector",
                "fields": [
                    {{"name": "field1", "selector": "css_selector", "type": "text"}},
                    {{"name": "field2", "selector": "css_selector", "type": "link"}},
                    // more fields...
                ]
            }}

            Make selectors as specific as possible to avoid false matches.
            """
        }
    }

    crawler_params = {
        "extraction_strategy": extraction_strategy,
        "wait_for": "css:body",
        "remove_overlay_elements": True
    }

    result = await crawl_url(url, crawler_params=crawler_params)

    if result.success and result.extracted_content:
        try:
            schema = json.loads(result.extracted_content)

            if "name" not in schema:
                schema["name"] = "items"
            if "fields" not in schema:
                print("⚠️ Generated schema missing fields, using fallback")
                schema = {
                    "name": "items",
                    "baseSelector": "div.item, article, .product",
                    "fields": [
                        {"name": "title", "selector": "h1, h2, h3", "type": "text"},
                        {"name": "description", "selector": "p", "type": "text"},
                        {"name": "link", "selector": "a", "type": "attribute", "attribute": "href"}
                    ]
                }

            with open(output_file, "w") as f:
                json.dump(schema, f, indent=2)

            print(f"✅ Schema generated and saved to: {output_file}")
            print(f"📋 Schema structure:")
            print(json.dumps(schema, indent=2))
            return schema

        except json.JSONDecodeError as e:
            print(f"❌ Failed to parse generated schema: {e}")
            print("Raw output:", result.extracted_content[:500])
            return None
    else:
        print(f"❌ Failed to generate schema: {result.error_message if result else 'Unknown error'}")
        return None

async def use_generated_schema(url: str, schema_file: str):
    """
    Step 2: Use the generated schema for fast, repeated extractions
    No LLM calls needed - pure CSS extraction
    """
    print(f"📂 Loading schema from: {schema_file}")

    try:
        with open(schema_file, "r") as f:
            schema = json.load(f)
    except FileNotFoundError:
        print(f"❌ Schema file not found: {schema_file}")
        print("💡 Generate a schema first using: python extraction_pipeline.py --generate-schema <url> \"<instruction>\"")
        return None

    print("🚀 Extracting data using generated schema (no LLM calls)...")

    extraction_strategy = {
        "type": "JsonCssExtractionStrategy",
        "params": {
            "schema": schema,
            "verbose": True
        }
    }

    crawler_params = {
        "extraction_strategy": extraction_strategy,
        "wait_for": "css:body"
    }

    result = await crawl_url(url, crawler_params=crawler_params)

    if result.success and result.extracted_content:
        data = json.loads(result.extracted_content)
        items = data.get(schema.get("name", "items"), [])

        print(f"✅ Extracted {len(items)} items using schema")

        with open("extracted_data.json", "w") as f:
            json.dump(data, f, indent=2)
        print("💾 Saved to extracted_data.json")

        if items:
            print("\n📋 Sample (first item):")
            print(json.dumps(items[0], indent=2))
        return data
    else:
        print(f"❌ Extraction failed: {result.error_message if result else 'Unknown error'}")
        return None

# =============================================================================
# APPROACH 2: Manual Schema Definition
# =============================================================================

async def extract_with_manual_schema(url: str, schema: dict = None):
    """Use a manually defined CSS/JSON schema"""
    if not schema:
        schema = {
            "name": "content",
            "baseSelector": "body",
            "fields": [
                {"name": "title", "selector": "h1", "type": "text"},
                {"name": "paragraphs", "selector": "p", "type": "text", "all": True},
                {"name": "links", "selector": "a", "type": "attribute", "attribute": "href", "all": True}
            ]
        }

    print("📐 Using manual CSS/JSON schema for extraction...")

    extraction_strategy = {
        "type": "JsonCssExtractionStrategy",
        "params": {
            "schema": schema,
            "verbose": True
        }
    }

    crawler_params = {
        "extraction_strategy": extraction_strategy
    }

    result = await crawl_url(url, crawler_params=crawler_params)

    if result.success and result.extracted_content:
        data = json.loads(result.extracted_content)
        if isinstance(data, list):
            items = data
        else:
            items = data.get(schema["name"], [])

        print(f"✅ Extracted {len(items)} items using manual schema")

        with open("manual_extracted.json", "w") as f:
            json.dump(data, f, indent=2)
        print("💾 Saved to manual_extracted.json")
        return data
    else:
        print(f"❌ Extraction failed: {result.error_message if result else 'Unknown error'}")
        return None

# =============================================================================
# APPROACH 3: Direct LLM Extraction
# =============================================================================

async def extract_with_llm(url: str, instruction: str):
    """Direct LLM extraction via hosted service"""
    print("🤖 Using direct LLM extraction...")

    extraction_strategy = {
        "type": "LLMExtractionStrategy",
        "params": {
            "provider": "openai/gpt-4o-mini",
            "instruction": instruction,
            "schema": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "items": {"type": "object"}
                    },
                    "summary": {"type": "string"}
                }
            }
        }
    }

    crawler_params = {
        "extraction_strategy": extraction_strategy,
        "wait_for": "css:body",
        "remove_overlay_elements": True
    }

    result = await crawl_url(url, crawler_params=crawler_params)

    if result.success and result.extracted_content:
        try:
            data = json.loads(result.extracted_content)
            items = data.get('items', [])

            print(f"✅ LLM extracted {len(items)} items")
            print(f"📝 Summary: {data.get('summary', 'N/A')}")

            with open("llm_extracted.json", "w") as f:
                json.dump(data, f, indent=2)
            print("💾 Saved to llm_extracted.json")

            if items:
                print("\n📋 Sample (first item):")
                print(json.dumps(items[0], indent=2))
            return data
        except json.JSONDecodeError:
            print("⚠️ Could not parse LLM output as JSON")
            print(result.extracted_content[:500])
            return None
    else:
        print(f"❌ LLM extraction failed: {result.error_message if result else 'Unknown error'}")
        return None

# =============================================================================
# Main CLI Interface
# =============================================================================

async def main():
    if len(sys.argv) < 3:
        print("""
Crawl4AI Extraction Pipeline using hosted service

Options:
    python extraction_pipeline.py --generate-schema <url> "<what to extract>"
    python extraction_pipeline.py --use-schema <url> generated_schema.json
    python extraction_pipeline.py --manual <url>
    python extraction_pipeline.py --llm <url> "<extraction instruction>"
""")
        sys.exit(1)

    mode = sys.argv[1]
    url = sys.argv[2]

    if mode == "--generate-schema":
        if len(sys.argv) < 4:
            print("Error: Missing extraction instruction")
            sys.exit(1)
        instruction = sys.argv[3]
        output_file = sys.argv[4] if len(sys.argv) > 4 else "generated_schema.json"
        await generate_schema(url, instruction, output_file)

    elif mode == "--use-schema":
        if len(sys.argv) < 4:
            print("Error: Missing schema file")
            sys.exit(1)
        schema_file = sys.argv[3]
        await use_generated_schema(url, schema_file)

    elif mode == "--manual":
        await extract_with_manual_schema(url)

    elif mode == "--llm":
        if len(sys.argv) < 4:
            print("Error: Missing extraction instruction")
            sys.exit(1)
        instruction = sys.argv[3]
        await extract_with_llm(url, instruction)

    else:
        print(f"Unknown mode: {mode}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())