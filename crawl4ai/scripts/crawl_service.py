import os
import json
import urllib.request
import urllib.error
import asyncio

class StringCompatibleMarkdown:
    def __init__(self, raw_markdown: str, fit_markdown: str = None):
        self.raw_markdown = raw_markdown
        self.fit_markdown = fit_markdown or raw_markdown

    def __str__(self):
        return self.fit_markdown or self.raw_markdown

class CrawlResult:
    def __init__(self, success: bool, url: str, data: dict = None, error_message: str = ""):
        self.success = success
        self.url = url
        self.error_message = error_message
        
        if data is None:
            data = {}
            
        self.html = data.get("html") or data.get("cleaned_html") or ""
        self.cleaned_html = data.get("cleaned_html") or ""
        
        md_data = data.get("markdown")
        if isinstance(md_data, dict):
            raw_md = md_data.get("raw_markdown") or ""
            fit_md = md_data.get("fit_markdown") or ""
        elif isinstance(md_data, str):
            raw_md = md_data
            fit_md = md_data
        else:
            raw_md = ""
            fit_md = ""
            
        self.markdown = StringCompatibleMarkdown(raw_md, fit_md)
        
        links_data = data.get("links")
        if isinstance(links_data, dict):
            self.links = links_data
        elif isinstance(links_data, list):
            self.links = {"internal": links_data, "external": []}
        else:
            self.links = {"internal": [], "external": []}
            
        media_data = data.get("media")
        if isinstance(media_data, dict):
            self.media = media_data
        else:
            self.media = {"images": [], "videos": []}
            
        self.metadata = data.get("metadata") or {}
        if "title" not in self.metadata:
            self.metadata["title"] = data.get("title") or ""
            
        self.screenshot = data.get("screenshot") or ""
        
        ext_content = data.get("extracted_content")
        if isinstance(ext_content, (dict, list)):
            self.extracted_content = json.dumps(ext_content)
        else:
            self.extracted_content = ext_content or ""

_JWT_TOKEN = None

async def _get_jwt_token(api_url: str, api_token: str) -> str:
    global _JWT_TOKEN
    if _JWT_TOKEN:
        return _JWT_TOKEN
        
    endpoint = f"{api_url.rstrip('/')}/token"
    payload = {"email": "agent@novuscotia.com", "api_token": api_token}
    
    headers = {
        "Content-Type": "application/json"
    }
    if api_token:
        headers["Authorization"] = f"Bearer {api_token}"
        
    try:
        loop = asyncio.get_running_loop()
        data_bytes = json.dumps(payload).encode("utf-8")
        
        def _sync_post():
            req = urllib.request.Request(endpoint, data=data_bytes, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=10) as response:
                    return response.status, response.read()
            except urllib.error.HTTPError as e:
                return e.code, e.read()
                
        status, response_bytes = await loop.run_in_executor(None, _sync_post)
        if 200 <= status < 300:
            response_json = json.loads(response_bytes.decode("utf-8"))
            _JWT_TOKEN = response_json.get("access_token") or api_token
            return _JWT_TOKEN
        else:
            return api_token
    except Exception:
        return api_token

async def crawl_url(url: str, crawler_params: dict = None, browser_params: dict = None) -> CrawlResult:
    api_url = os.environ.get("CRAWL4AI_URL") or os.environ.get("CRAWL4AI_API_URL") or "https://crawl4ai.service.internal.novuscotia.com"
    auth_token = os.environ.get("CRAWL4AI_AUTH_TOKEN")
    
    # Resolve JWT if necessary
    if auth_token:
        active_token = await _get_jwt_token(api_url, auth_token)
    else:
        active_token = None
        
    endpoint = f"{api_url.rstrip('/')}/crawl"
    
    payload = {
        "urls": [url],
    }
    
    crawler_config = {}
    
    if crawler_params:
        if "extraction_strategy" in crawler_params:
            crawler_config["extraction_strategy"] = crawler_params["extraction_strategy"]
            payload["extraction_strategy"] = crawler_params["extraction_strategy"]
            
        if "markdown_generator" in crawler_params:
            crawler_config["markdown_generator"] = crawler_params["markdown_generator"]
            gen = crawler_params["markdown_generator"]
            if isinstance(gen, dict):
                # Handle strict schema structure (type/params) or flat structure
                gen_params = gen.get("params", gen)
                if isinstance(gen_params, dict) and "content_filter" in gen_params:
                    filt = gen_params["content_filter"]
                    if isinstance(filt, dict):
                        filt_params = filt.get("params", filt)
                        if isinstance(filt_params, dict) and "user_query" in filt_params:
                            payload["query"] = filt_params["user_query"]
                            
        for k, v in crawler_params.items():
            if k not in ["extraction_strategy", "markdown_generator"]:
                crawler_config[k] = v
                payload[k] = v
                    
    if crawler_config:
        payload["crawler_params"] = crawler_config
        
    if browser_params:
        payload["browser_params"] = browser_params
        payload["browser_config"] = {
            "type": "BrowserConfig",
            "params": browser_params
        }
        
    headers = {
        "Content-Type": "application/json"
    }
    if active_token:
        headers["Authorization"] = f"Bearer {active_token}"
        
    try:
        loop = asyncio.get_running_loop()
        data_bytes = json.dumps(payload).encode("utf-8")
        
        def _sync_post():
            req = urllib.request.Request(endpoint, data=data_bytes, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=60) as response:
                    return response.status, response.read()
            except urllib.error.HTTPError as e:
                return e.code, e.read()
            except urllib.error.URLError as e:
                raise e
                
        status, response_bytes = await loop.run_in_executor(None, _sync_post)
        response_json = json.loads(response_bytes.decode("utf-8"))
        
        if 200 <= status < 300:
            result_data = None
            if "results" in response_json and isinstance(response_json["results"], list) and len(response_json["results"]) > 0:
                result_data = response_json["results"][0]
            elif "result" in response_json:
                result_data = response_json["result"]
            else:
                result_data = response_json
            return CrawlResult(success=True, url=url, data=result_data)
        else:
            if status >= 500:
                import sys
                print(f"RAW 500 RESPONSE: {response_bytes.decode('utf-8', errors='replace')}", file=sys.stderr)
            error_msg = "Unknown error"
            if isinstance(response_json, dict):
                error_msg = response_json.get("detail") or response_json.get("error") or "Unknown error"
            return CrawlResult(success=False, url=url, error_message=f"Request failed: {error_msg} (status {status})")
            
    except Exception as e:
        return CrawlResult(success=False, url=url, error_message=f"HTTP Request failed: {str(e)}")

async def crawl_many(urls: list, crawler_params: dict = None, browser_params: dict = None, max_concurrent: int = 5) -> list:
    sem = asyncio.Semaphore(max_concurrent)
    async def safe_crawl(url):
        async with sem:
            return await crawl_url(url, crawler_params=crawler_params, browser_params=browser_params)
    return await asyncio.gather(*(safe_crawl(url) for url in urls))
