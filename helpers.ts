
export const emojiToSVG = (content: string): string => {
  const displayContent = content.slice(0, 2);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
      <rect width="100" height="100" fill="#1e1e1e"/>
      <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="50" fill="white" font-family="Arial, sans-serif">
        ${displayContent}
      </text>
    </svg>
  `.trim();
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
};

export const generateId = () => Math.random().toString(36).substr(2, 9);

export const formatTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const formatFullDate = (timestamp: number) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 3600 * 24));
  
  if (diffDays === 0) return `Today, ${formatTime(timestamp)}`;
  if (diffDays === 1) return `Yesterday, ${formatTime(timestamp)}`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

export const getChatId = (uid1: string, uid2: string) => {
  return [uid1, uid2].sort().join('_');
};
