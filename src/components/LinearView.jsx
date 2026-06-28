import { useEffect, useRef, useState } from 'react'
import './LinearView.css'

const THREAD_ENTRIES = [
  {
    id: 1,
    date: 'Jun 14',
    time: '09:12',
    content:
      'Started the redesign of the editor toolbar. The current layout is too cluttered — moved bold/italic/link into a collapsed inline menu that only surfaces on selection.',
  },
  {
    id: 2,
    date: 'Jun 15',
    time: '14:03',
    content:
      'Realised the font pairing was wrong. Switched body to JetBrains Mono — it reads better at small sizes and the monospace rhythm feels intentional rather than incidental.',
  },
  {
    id: 3,
    date: 'Jun 18',
    time: '11:47',
    content:
      'Dark background constraint: #08090A is near-pure black. The problem with liquid glass on pure dark is the glass has nothing bright to refract. Need an ambient light source behind the button.',
  },
  {
    id: 4,
    date: 'Jun 20',
    time: '16:30',
    content:
      'Added a radial teal gradient at 6% opacity under the Save My Place button. The glass refracts it just enough to be readable without the glow itself being visible.',
  },
  {
    id: 5,
    date: 'Jun 22',
    time: '08:55',
    content:
      'WebGL fallback implemented. If html2canvas fails (common in localhost due to CORS), the glass canvas is blank. Detect via imageData alpha and swap to a backdrop-filter CSS pill instead.',
  },
  {
    id: 6,
    date: 'Jun 24',
    time: '19:41',
    content:
      'Tuned rimIntensity to 0.18 and blurRadius to 18. Edge refraction is the main cue on dark — without it the pill is invisible. The default library values are calibrated for light/colored surfaces.',
  },
]

export default function LinearView() {
  const saveButtonRef = useRef(null)
  const [showModal, setShowModal] = useState(false)
  const [savedEntry, setSavedEntry] = useState(null)

  function handleSaveMyPlace() {
    const last = THREAD_ENTRIES[THREAD_ENTRIES.length - 1]
    setSavedEntry(last)
    setShowModal(true)
  }

  useEffect(() => {
    if (!saveButtonRef.current) return

    // Small delay — html2canvas needs a complete DOM snapshot before capturing
    const initTimer = setTimeout(() => {
      const ButtonClass = window.Button
      if (!ButtonClass) {
        renderFallback()
        return
      }

      let glassBtn
      try {
        glassBtn = new ButtonClass({
          text: '⊙ Save my place',
          fontSize: 13,
          type: 'pill',
          // Higher than default — dark backgrounds need more tint to reveal the glass surface
          tintOpacity: 0.35,
          // Center warp disabled — invisible on dark anyway, wastes WebGL budget
          warp: false,
        })
      } catch {
        renderFallback()
        return
      }

      // Match Thread's typography
      if (glassBtn.textElement) {
        glassBtn.textElement.style.fontFamily = "'JetBrains Mono', monospace"
        glassBtn.textElement.style.fontSize = '11px'
        glassBtn.textElement.style.letterSpacing = '0.03em'
        glassBtn.textElement.style.color = '#E8E6DC'
      }

      // Wire up click before inserting into DOM
      if (glassBtn.element) {
        glassBtn.element.addEventListener('click', handleSaveMyPlace)
        glassBtn.element.style.cursor = 'pointer'
      }

      const wrapper = saveButtonRef.current
      wrapper.innerHTML = ''
      if (glassBtn.element) {
        wrapper.appendChild(glassBtn.element)
      } else {
        renderFallback()
        return
      }

      // After render, check whether the WebGL canvas captured anything
      const fallbackTimer = setTimeout(() => {
        const canvas = glassBtn.canvas
        if (!canvas) {
          renderFallback()
          return
        }
        try {
          const ctx = canvas.getContext('2d')
          const imageData = ctx.getImageData(0, 0, 1, 1)
          if (imageData.data[3] === 0) {
            renderFallback()
          }
        } catch {
          // Cross-origin canvas read blocked — assume WebGL worked, leave as-is
        }
      }, 800)

      return () => clearTimeout(fallbackTimer)
    }, 300)

    return () => clearTimeout(initTimer)

    function renderFallback() {
      const wrapper = saveButtonRef.current
      if (!wrapper) return
      wrapper.innerHTML = ''
      const btn = document.createElement('button')
      btn.textContent = '⊙ Save my place'
      btn.className = 'save-btn-fallback'
      btn.onclick = handleSaveMyPlace
      wrapper.appendChild(btn)
    }
  }, [])

  return (
    <div className="linear-view">
      <header className="linear-header">
        <span className="linear-title">Linear</span>
        <span className="linear-count">{THREAD_ENTRIES.length} entries</span>
      </header>

      <div className="linear-scroll">
        <div className="thread-list">
          {THREAD_ENTRIES.map((entry) => (
            <article key={entry.id} className="thread-entry">
              <div className="entry-meta">
                <span className="entry-date">{entry.date}</span>
                <span className="entry-time">{entry.time}</span>
              </div>
              <p className="entry-content">{entry.content}</p>
            </article>
          ))}
        </div>

        {/* Draft editor area — glass button's ambient light source lives here */}
        <div className="draft-editor-container">
          <textarea
            className="draft-editor"
            placeholder="Continue the thread…"
            rows={4}
          />
        </div>
      </div>

      {/* Save My Place button — liquid glass renders here via useEffect */}
      <div
        ref={saveButtonRef}
        style={{
          position: 'absolute',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      >
        {/* Glass button mounts here; falls back to CSS pill if WebGL fails */}
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p className="modal-label">Place saved</p>
            {savedEntry && (
              <p className="modal-excerpt">
                {savedEntry.date} · {savedEntry.content.slice(0, 80)}…
              </p>
            )}
            <button className="modal-close" onClick={() => setShowModal(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
