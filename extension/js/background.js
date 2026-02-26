chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'search') {
    chrome.search.query({ text: message.query, disposition: 'CURRENT_TAB' });
  }
});
