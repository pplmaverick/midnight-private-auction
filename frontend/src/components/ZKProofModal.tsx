import { useEffect, useState } from 'react'

const statusTexts = [
  'Generating zero-knowledge proof...',
  'Encrypting bid parameters...',
  'Assembling proof circuits...',
  'Sealing bid on Midnight Network...',
  'Finalizing secure handshake...',
]

interface ZKProofModalProps {
  onBack: () => void
}

export default function ZKProofModal({ onBack }: ZKProofModalProps) {
  const [textIndex, setTextIndex] = useState(0)
  const [textVisible, setTextVisible] = useState(true)
  const [progress, setProgress] = useState(0)
  const [succeeded, setSucceeded] = useState(false)

  useEffect(() => {
    const progressTimer = setTimeout(() => setProgress(100), 100)

    const cycleTimer = setInterval(() => {
      setTextVisible(false)
      setTimeout(() => {
        setTextIndex((i) => (i + 1) % statusTexts.length)
        setTextVisible(true)
      }, 500)
    }, 2500)

    const successTimer = setTimeout(() => setSucceeded(true), 8000)

    return () => {
      clearTimeout(progressTimer)
      clearInterval(cycleTimer)
      clearTimeout(successTimer)
    }
  }, [])

  const statusText = succeeded ? 'Bid Successfully Secured' : statusTexts[textIndex]

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-3xl overflow-hidden">
      <div className="absolute inset-0 z-0 opacity-40"></div>

      <div className="relative z-10 w-full max-w-2xl px-margin-mobile text-center">
        <div className="relative h-64 w-64 mx-auto mb-stack-lg">
          <svg className="w-full h-full zk-hex-grid" viewBox="0 0 100 100">
            <polygon
              className="hex-animate"
              fill="none"
              points="50,15 80,32.5 80,67.5 50,85 20,67.5 20,32.5"
              stroke="#d2bbff"
              strokeWidth="0.5"
              style={{ animationDelay: '0s' }}
            ></polygon>
            <polygon
              className="hex-animate"
              fill="none"
              points="50,5 90,27.5 90,72.5 50,95 10,72.5 10,27.5"
              stroke="#7c3aed"
              strokeWidth="0.3"
              style={{ animationDelay: '0.5s' }}
            ></polygon>
            <polygon
              className="hex-animate"
              fill="none"
              points="50,25 72,37.5 72,62.5 50,75 28,62.5 28,37.5"
              stroke="#ccbeff"
              strokeWidth="0.7"
              style={{ animationDelay: '1s' }}
            ></polygon>
            <circle className="hex-animate" cx="50" cy="15" fill="#d2bbff" r="1.5"></circle>
            <circle
              className="hex-animate"
              cx="80"
              cy="32.5"
              fill="#d2bbff"
              r="1.5"
              style={{ animationDelay: '0.2s' }}
            ></circle>
            <circle
              className="hex-animate"
              cx="80"
              cy="67.5"
              fill="#d2bbff"
              r="1.5"
              style={{ animationDelay: '0.4s' }}
            ></circle>
            <circle
              className="hex-animate"
              cx="50"
              cy="85"
              fill="#d2bbff"
              r="1.5"
              style={{ animationDelay: '0.6s' }}
            ></circle>
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className={`material-symbols-outlined text-5xl animate-pulse ${succeeded ? 'text-success' : 'text-primary'}`}
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              lock
            </span>
          </div>
        </div>

        <div className="mb-stack-lg">
          <h2
            className={`font-headline-md text-headline-md mb-2 transition-all duration-500 ${textVisible ? 'opacity-100' : 'opacity-0'} ${succeeded ? 'text-success' : 'text-text-primary'}`}
          >
            {statusText}
          </h2>
          <div className="flex items-center justify-center gap-2">
            <span className="font-label-mono text-secondary uppercase tracking-[0.2em]">
              Processing Private Transaction
            </span>
            <span className="w-1 h-1 rounded-full bg-secondary animate-ping"></span>
          </div>
        </div>

        <div className="w-full h-1 bg-surface-container-highest rounded-full overflow-hidden mb-stack-md">
          <div
            className={`h-full transition-all duration-[4000ms] ease-linear shadow-[0_0_15px_#7c3aed] ${succeeded ? 'bg-success' : 'bg-primary-container'}`}
            style={{ width: `${progress}%` }}
          ></div>
        </div>

        <div className="glass-panel p-stack-md rounded-xl inline-flex items-center gap-3">
          <span className="material-symbols-outlined text-secondary text-sm">security</span>
          <p className="font-label-mono text-xs text-on-surface-variant">
            Technical note: Your bid amount never leaves your device unencrypted
          </p>
        </div>

        {succeeded && (
          <div className="mt-stack-lg">
            <button
              type="button"
              onClick={() => onBack()}
              className="bg-primary-container text-on-primary-container px-8 py-4 rounded-lg font-bold text-lg hover:shadow-[0_0_25px_rgba(124,58,237,0.5)] transition-all active:scale-95"
            >
              Back to Auction
            </button>
          </div>
        )}
      </div>

      <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-primary/10 rounded-full blur-3xl animate-pulse"></div>
      <div
        className="absolute bottom-1/4 right-1/4 w-48 h-48 bg-secondary/10 rounded-full blur-3xl animate-pulse"
        style={{ animationDelay: '1s' }}
      ></div>
    </div>
  )
}
