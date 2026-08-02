export function RestoreDialog({ onRestore, onDiscard }: { onRestore: () => void; onDiscard: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Letzte Sitzung wiederherstellen">
        <h2>Letzte Sitzung wiederherstellen</h2>
        <div className="modal-content">Es wurde ein lokal gespeicherter Arbeitsstand gefunden. Er befindet sich ausschließlich in diesem Browser.</div>
        <div className="modal-actions"><button onClick={onDiscard}>Verwerfen</button><button onClick={onRestore}>Wiederherstellen</button></div>
      </div>
    </div>
  );
}
