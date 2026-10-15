import { Link } from "react-router-dom";

export function NotFoundPage(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-5xl font-extrabold text-blue-700">404</p>
      <h1 className="mt-3 text-xl font-bold text-slate-900">Trang không tồn tại</h1>
      <p className="mt-2 text-sm text-slate-600">
        Đường dẫn bạn yêu cầu không khả dụng hoặc đã được di chuyển.
      </p>
      <Link
        to="/amazon-crawler"
        className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
      >
        Về Distributed Crawler
      </Link>
    </div>
  );
}
