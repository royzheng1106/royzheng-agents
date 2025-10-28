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

        const response = await fetch(this.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Authorization': 'Bearer ' + this.apiKey,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
        }
        const contentType = response.headers.get('content-type') || '';
        // Non-streaming JSON response
        if (contentType.includes('application/json')) {
            return (await response.json()) as T;
        }

        // SSE fallback (diagnostic)
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            // Optional: also show parsed lines for debugging
            const lines = buffer.split('\n');
            for (const line of lines) {
                if (line.startsWith('data:')) {
                    const jsonStr = line.replace(/^data:\s*/, '');
                    try {
                        const parsed = JSON.parse(jsonStr);
                        return parsed as T;
                    } catch (err) {
                    }
                }
            }
        }
        throw new Error('No valid JSON received from MCP SSE or plain JSON');

    }


    /** Fetch the list of available tools from the MCP server, cleaned for LLM use */
    async listTools(): Promise<Array<{ name: string; description: string; parameters: Record<string, any> }>> {
        const data = await this.request<MCPListToolsResponse>('tools/list');
        console.log(data);
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
        console.log(`In Call Tool`);
        const data = await this.request<MCPCallToolResponse>('tools/call', params);
        console.log(`Tool Results: ${data}`);
        return data.result;
    }
}