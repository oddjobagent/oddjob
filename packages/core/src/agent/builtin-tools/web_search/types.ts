export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  maxResults?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface SearchProvider {
  name: string;
  search(query: string, opts: SearchProviderOptions): Promise<SearchResult[]>;
}
