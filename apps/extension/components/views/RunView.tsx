export default function RunView() {
  return (
    <section>
      <p style={{ fontSize: 13, color: '#555', margin: '0 0 12px' }}>
        Import a scenario and run it — no setup needed for static-only
        scenarios.
      </p>
      <button
        style={{
          fontSize: 13,
          padding: '6px 12px',
          border: '1px solid #ccc',
          borderRadius: 6,
          background: '#fff',
          cursor: 'pointer',
        }}
      >
        Import scenario…
      </button>
      <p style={{ fontSize: 12, color: '#999', marginTop: 24 }}>
        Scenario picker, environment selector, and run report land in Phase 4
        (T4.1–T4.2).
      </p>
    </section>
  );
}
