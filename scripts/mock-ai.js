// Minimal OpenAI-compatible mock for testing the AI plumbing end-to-end.
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT) || 9100;

function respond(body) {
  const sys = body.messages.find((m) => m.role === 'system')?.content ?? '';
  const last = body.messages[body.messages.length - 1];

  // after a tool result → final answer
  if (last.role === 'tool') {
    const rows = JSON.parse(last.content).rows;
    const n = Array.isArray(rows) && rows[0] ? Object.values(rows[0])[0] : '?';
    return { content: `According to the database, the answer is: ${n}` };
  }

  if (sys.includes('categorize bank transactions')) {
    const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
    const first = user.match(/id=(\d+)/);
    return {
      content: JSON.stringify([
        { id: Number(first?.[1] ?? 1), category: 'Groceries', confidence: 0.9 },
      ]),
    };
  }

  if (sys.includes('PROPOSES')) {
    return {
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'set_category_budget',
            arguments: JSON.stringify({ category_name: 'Groceries', monthly_amount: 650 }),
          },
        },
      ],
    };
  }

  if (body.tools?.some((t) => t.function?.name === 'run_sql')) {
    return {
      tool_calls: [
        {
          id: 'call_sql_1',
          type: 'function',
          function: {
            name: 'run_sql',
            arguments: JSON.stringify({ query: 'SELECT COUNT(*) AS n FROM transactions' }),
          },
        },
      ],
    };
  }

  if (sys.includes('map bank statement files')) {
    return {
      content: JSON.stringify({
        header_row_index: 0,
        col_date: 0,
        col_description: 1,
        col_amount: 2,
        col_in: null,
        col_out: null,
        col_state: null,
        ignore_states: [],
        col_type: null,
        col_currency: null,
        date_format: 'DD.MM.YYYY',
        decimal_point: ',',
        notes: 'German CSV with DD.MM.YYYY dates and comma decimals',
      }),
    };
  }

  return { content: 'OK' };
}

http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url.endsWith('/models')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({ data: [{ id: 'mock-large' }, { id: 'mock-mini' }, { id: 'mock-vision' }] })
      );
      return;
    }
    if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        const body = JSON.parse(data);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: respond(body) }] }));
      });
      return;
    }
    res.writeHead(404).end();
  })
  .listen(PORT, () => console.log(`mock AI on :${PORT}`));
