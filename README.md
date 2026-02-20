# Restaurant Chat 🍜

AI-powered chat widget for restaurant ordering. Customers chat naturally to browse menus and place orders.

## Quick Start

```bash
git clone https://github.com/ronnc/restaurant-chat.git
cd restaurant-chat
npm install
```

### Run with Ollama (local)

```bash
LLM_PROVIDER=ollama OLLAMA_MODEL=llama3.1:8b npm start
```

### Run with Anthropic

```bash
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-api03-xxx npm start
```

Server starts at **http://localhost:3456**

## Embedding in Your Website

Add a single script tag to any webpage:

```html
<script src="https://your-server.com/widget.js" data-restaurant="your-slug"></script>
```

That's it. A chat bubble (🍜) appears in the bottom-right corner. Clicking it opens the ordering chat.

### Full Example

```html
<!DOCTYPE html>
<html>
<head>
  <title>My Restaurant</title>
</head>
<body>
  <h1>Welcome to My Restaurant</h1>
  <p>Click the chat icon to order!</p>

  <!-- Add this line before </body> -->
  <script src="https://your-server.com/widget.js" data-restaurant="my-restaurant"></script>
</body>
</html>
```

### Widget Options

| Attribute | Description | Example |
|-----------|-------------|---------|
| `src` | URL to your hosted widget.js | `https://chat.myrestaurant.com/widget.js` |
| `data-restaurant` | Restaurant identifier (slug) | `thai-basil` |

### How It Works

1. The script injects a floating chat button on the page
2. Clicking the button opens an iframe with the chat UI
3. The chat connects to your backend server's `/api/chat` endpoint
4. The AI handles the ordering conversation
5. Mobile responsive — adapts to small screens automatically

### Demo

Run the server and visit **http://localhost:3456/demo-site.html** to see the widget embedded in a sample restaurant page.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Server port |
| `LLM_PROVIDER` | `anthropic` | LLM provider (`anthropic` or `ollama`) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Anthropic model |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3` | Ollama model name |

## Project Structure

```
restaurant-chat/
├── server.js              # Express backend + LLM provider abstraction
├── public/
│   ├── index.html         # Full-page chat UI
│   ├── chat.html          # Chat UI (used by widget iframe)
│   ├── widget.js          # Embeddable widget script
│   └── demo-site.html     # Demo restaurant site
├── DATA_MODEL.md          # Database design doc
└── package.json
```

## License

MIT
