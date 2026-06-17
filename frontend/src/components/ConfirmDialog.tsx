import { Modal } from "./Modal";

export function ConfirmDialog({
  title,
  detail,
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
  loading = false,
  onConfirm,
  onClose,
}: {
  title: string;
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} width={460} onClose={onClose}>
      <div className="confirm-dialog">
        {detail && <p>{detail}</p>}
        <div className="toolbar">
          <button className={`btn ${danger ? "danger" : "primary"}`} type="button" disabled={loading} onClick={onConfirm}>
            {confirmText}
          </button>
          <button className="btn" type="button" onClick={onClose}>
            {cancelText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
