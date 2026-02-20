// Restaurant Chat Widget
// Usage: <script src="https://your-server.com/widget.js" data-restaurant="slug"></script>
(function () {
  const script = document.currentScript;
  const serverUrl = script.src.replace('/widget.js', '');
  const restaurant = script.getAttribute('data-restaurant') || 'demo';

  // Styles
  const style = document.createElement('style');
  style.textContent = `
    #rc-widget-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: #e65100;
      color: white;
      border: none;
      font-size: 28px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      z-index: 99999;
      transition: transform 0.2s;
    }
    #rc-widget-btn:hover { transform: scale(1.1); }
    #rc-widget-frame {
      position: fixed;
      bottom: 96px;
      right: 24px;
      width: 380px;
      height: 550px;
      border: none;
      border-radius: 16px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.2);
      z-index: 99999;
      display: none;
      background: white;
    }
    @media (max-width: 480px) {
      #rc-widget-frame {
        width: calc(100vw - 16px);
        height: calc(100vh - 120px);
        right: 8px;
        bottom: 88px;
      }
    }
  `;
  document.head.appendChild(style);

  // Chat button
  const btn = document.createElement('button');
  btn.id = 'rc-widget-btn';
  btn.innerHTML = '🍜';
  btn.title = 'Chat with us';
  document.body.appendChild(btn);

  // Iframe
  const iframe = document.createElement('iframe');
  iframe.id = 'rc-widget-frame';
  iframe.src = `${serverUrl}/chat.html?restaurant=${restaurant}`;
  document.body.appendChild(iframe);

  let open = false;
  btn.addEventListener('click', () => {
    open = !open;
    iframe.style.display = open ? 'block' : 'none';
    btn.innerHTML = open ? '✕' : '🍜';
  });
})();
