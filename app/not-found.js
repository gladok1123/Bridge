import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100dvh', textAlign: 'center', gap: 12 }}>
      <div>
        <h1 style={{ margin: 0 }}>Такой комнаты нет</h1>
        <p style={{ color: 'var(--muted)' }}>
          Возможно, ссылку сократили не полностью. Вернитесь на главную и создайте новую комнату.
        </p>
        <Link className="btn btn--brand" href="/">На главную</Link>
      </div>
    </div>
  );
}
