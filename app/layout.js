import './globals.css';

export const metadata = {
  title: 'Bridge — звонки, демонстрация экрана, доска и чат',
  description:
    'Bridge — прямые P2P-звонки в браузере: звук и видео идут между участниками, без серверов в середине. Демонстрация экрана, общая доска, чат и запись разговора.',
  applicationName: 'Bridge',
  keywords: ['звонки', 'web rtc', 'p2p', 'демонстрация экрана', 'доска', 'чат', 'bridge'],
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Bridge — звонки, которые идут напрямую',
    description: 'P2P-звонок, показ экрана, общая доска и чат. Ссылка-приглашение, без регистрации.',
    type: 'website',
  },
  icons: {
    icon: [{ url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%235865f2" stroke-width="2.2" stroke-linecap="round"><path d="M4 17c3.5 0 5.5-10 9-10s3 6 7 6"/></svg>') }],
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1e1f22',
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
