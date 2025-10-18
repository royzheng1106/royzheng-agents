/**
 * src/client/mcp.ts
 *
 * A lightweight MCP client that can:
 *  - List tools (`tools/list`)
 *  - Call a tool (`tools/call`)
 */

export interface MCPTool {
    name: string;
    description: string;
    inputSchema: Record<string, any>;
}

export interface MCPListToolsResponse {
    result: {
        tools: MCPTool[];
    };
    jsonrpc: string;
    id: string;
}

export interface MCPCallToolParams {
    name: string;
    arguments?: Record<string, any>;
}

export interface MCPCallToolResponse {
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
    jsonrpc: string;
    id: string;
}

export class MCPClient {
    private url: string;
    private apiKey: string;

    constructor(url: string, apiKey: string) {
        this.url = url;
        this.apiKey = apiKey;
    }

    private async request<T = any>(method: string, params?: Record<string, any>): Promise<T> {
        const payload = {
            jsonrpc: '2.0',
            id: '1',
            method,
            ...(params ? { params } : {}),
        };

        const response = await fetch(`${this.url}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'x-api-key': this.apiKey,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split('\n')) {
                if (line.startsWith('data:')) {
                    const jsonStr = line.replace(/^data:\s*/, '');
                    try {
                        // parse JSON and cast to T
                        return JSON.parse(jsonStr) as T;
                    } catch {
                        // incomplete JSON, wait for next chunk
                    }
                }
            }
        }

        throw new Error('No valid JSON received from MCP SSE');
    }

    /** Fetch the list of available tools from the MCP server, cleaned for LLM use */
    async listTools(): Promise<Array<{ name: string; description: string; parameters: Record<string, any> }>> {
        const data = await this.request<MCPListToolsResponse>('tools/list');

        return data.result.tools.map(tool => {
            const { additionalProperties, $schema, ...cleanedParameters } = tool.inputSchema;
            return {
                name: tool.name,
                description: tool.description,
                parameters: cleanedParameters,
            };
        });
    }


    /** Call a specific MCP tool with optional arguments */
    async callTool(params: MCPCallToolParams): Promise<any> {
        const data = await this.request<MCPCallToolResponse>('tools/call', params);
        return data.result;
    }
}