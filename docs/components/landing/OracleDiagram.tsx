// Replaces the decorative bento photo in "Chrome is the oracle" with the
// section's actual claim: the engine's box and Chrome's box are the same box.
// The dashed outline drifts off and settles back exactly onto the solid one.
// Pure CSS (see .ld-oracle-* in global.css) — no client JS, so this stays a
// server component.

export function OracleDiagram() {
  return (
    <div className="ld-oracle" role="img" aria-label="The engine's computed box and Chrome's box agree exactly">
      <div className="ld-oracle-box ld-oracle-engine">
        <span className="ld-oracle-label" style={{ left: 10, bottom: 8, color: 'var(--color-accent-800)' }}>
          engine
        </span>
        <span
          className="ld-oracle-label"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: 14,
            color: 'var(--color-accent-800)',
          }}
        >
          x: 137
        </span>
      </div>
      <div className="ld-oracle-box ld-oracle-chrome">
        <span className="ld-oracle-label" style={{ right: 0, top: -24, color: 'var(--organic-text)' }}>
          chrome
        </span>
      </div>
      <p
        className="ld-oracle-label"
        style={{
          left: 0,
          right: 0,
          bottom: 20,
          margin: 0,
          textAlign: 'center',
          color: 'var(--color-neutral-500)',
        }}
      >
        Δ 0.0px · 5,304 fixtures agree
      </p>
    </div>
  );
}

export default OracleDiagram;
