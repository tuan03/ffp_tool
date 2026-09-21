import { Link } from "react-router-dom";

export function NotFoundPage(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-5xl font-extrabold text-cyan-400">404</p>
      <h1 className="mt-3 text-xl font-bold text-slate-100">Trang không tồn tại</h1>
      <p className="mt-2 text-sm text-slate-400">
        Đường dẫn bạn yêu cầu không khả dụng hoặc đã được di chuyển.
      </p>
      <Link
        to="/pinterest-pod"
        className="mt-6 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-cyan-400"
      >
        Về Pinterest POD Studio
      </Link>
    </div>
  );
}
