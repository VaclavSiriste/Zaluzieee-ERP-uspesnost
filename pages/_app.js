import '@/styles/globals.css'
import AccessGate from '@/components/AccessGate'

export default function App({ Component, pageProps }) {
  return (
    <AccessGate>
      <Component {...pageProps} />
    </AccessGate>
  )
}
