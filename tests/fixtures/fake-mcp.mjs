// Servidor MCP falso para las pruebas de dsh-rea.
import { createInterface } from 'node:readline'
const tools = [
  { name: 'analyze_javascript_application', description: 'Analyze an extracted JavaScript or Electron application directory. Returns modules and evidence.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'procedure_pseudo_code', description: 'Decompile a native procedure into pseudo code.', inputSchema: { type: 'object', properties: { address: { type: 'string' } } } },
  { name: 'capture_website_network', description: 'Open a website in a browser and capture network requests.', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } },
  { name: 'slow_tool', description: 'Waits forever.', inputSchema: { type: 'object' } },
]
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
createInterface({ input: process.stdin }).on('line', (l) => {
  const m = JSON.parse(l)
  if (m.method === 'initialize') return out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, serverInfo: { name: 'fake', version: '1' }, capabilities: { tools: {} }, instructions: 'Collect evidence first.' } })
  if (m.method === 'tools/list') return m.params?.cursor
    ? out({ jsonrpc: '2.0', id: m.id, result: { tools: tools.slice(2) } })
    : out({ jsonrpc: '2.0', id: m.id, result: { tools: tools.slice(0, 2), nextCursor: 'p2' } })
  if (m.method === 'tools/call') {
    const { name, arguments: a } = m.params
    if (name === 'slow_tool') return
    if (name === 'procedure_pseudo_code') return out({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: 'no provider configured' }] } })
    if (name === 'capture_website_network') return out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'x'.repeat(5000) }] } })
    return out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `modules of ${a.path}: main.js, preload.js` }], structuredContent: { modules: 2 } } })
  }
})
