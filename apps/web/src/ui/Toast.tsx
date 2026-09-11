/** 短暂提示条：人话文案，自动消失（由 controller 管理），不阻塞操作。 */
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="toast-host">
      <span className="toast">{message}</span>
    </div>
  );
}
