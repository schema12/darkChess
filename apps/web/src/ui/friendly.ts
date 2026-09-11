/**
 * 服务器协议错误码 → 用户可读文案。
 * 原则：正式 UI 只说人话；原始 code 进 console（调试面板后续接入）。
 */
export function friendlyRejection(code: string, reason: string): string {
  switch (code) {
    case 'notCurrentPlayer':
      return '还没轮到你行动';
    case 'playerEliminated':
      return '你已经被淘汰，无法继续行动';
    case 'illegalAction':
      return '这个动作不符合规则';
    case 'gameOver':
      return '对局已结束';
    case 'unknownPlayer':
      return '玩家身份无效，请重新加入房间';
    case 'roomClosed':
      return '房间已满或已开局';
    case 'roomFull':
      return '房间已满';
    case 'invalidToken':
      return '重连失败，请重新加入房间';
    default:
      return reason || '操作未被接受';
  }
}

/** 连接层错误信息 → 用户可读文案（保留原文到 console）。 */
export function friendlyConnectError(message: string): string {
  const codeMatch = /^(roomClosed|roomFull|invalidToken|gameOver|unknownPlayer|playerEliminated|illegalAction|notCurrentPlayer):/.exec(message);
  if (codeMatch) return friendlyRejection(codeMatch[1]!, message.slice(message.indexOf(':') + 1).trim());
  if (/连接超时|连接已断开|超时/.test(message)) return '无法连接服务器，请检查地址与网络';
  if (/Failed to connect|ECONNREFUSED|ENOTFOUND|network/i.test(message)) return '无法连接服务器，请检查地址与网络';
  return message;
}

/** 淘汰原因 → Toast 文案（与服务器声明的 reason 对应）。 */
export function eliminationText(playerId: string, reason: 'noLegalAction' | 'timeout' | 'resign'): string {
  const who = `玩家${playerId}`;
  if (reason === 'timeout') return `⏱ ${who}操作超时，已判负并淘汰`;
  if (reason === 'resign') return `${who}已认输淘汰`;
  return `⚠ ${who}无合法行动，已判负并淘汰`;
}
