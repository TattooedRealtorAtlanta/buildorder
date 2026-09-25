export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { messages, system } = req.body;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1000,
        system,
        messages
      })
    });
    const data = await response.json();
    // Surface upstream failures instead of passing them through as a 200.
    // A retired or misspelled model returns not_found_error here; the widget
    // then reads data.content[0].text as undefined and shows the generic
    // "couldn't get a response" line, which is why this went unnoticed from
    // the June 2026 sonnet-4 retirement until Anthropic emailed about it.
    if (!response.ok) {
      console.error('[chat] Anthropic API error', response.status, data && data.error);
      return res.status(response.status).json({ error: 'Upstream API error', detail: data && data.error });
    }
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: 'API error', detail: e.message });
  }
}
