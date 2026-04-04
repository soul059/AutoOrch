import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

interface Artifact {
  id: string;
  run_id: string;
  task_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

interface Props {
  runId: string;
}

export function ArtifactViewer({ runId }: Props) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [usage, setUsage] = useState<{ totalBytes: number; count: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    loadArtifacts();
  }, [runId]);

  const loadArtifacts = async () => {
    setLoading(true);
    try {
      const [artifactsData, usageData] = await Promise.all([
        api.listArtifacts(runId),
        api.getArtifactUsage(runId),
      ]);
      setArtifacts(artifactsData);
      setUsage(usageData);
    } catch (err) {
      console.error('Failed to load artifacts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (id: string, name: string) => {
    try {
      const blob = await api.downloadArtifact(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Download failed: ' + err.message);
    }
  };

  const handlePreview = async (id: string, mimeType: string) => {
    if (selectedArtifact === id) {
      setSelectedArtifact(null);
      setPreview(null);
      return;
    }
    
    try {
      const blob = await api.downloadArtifact(id);
      if (mimeType.startsWith('text/') || mimeType === 'application/json') {
        const text = await blob.text();
        setPreview(text);
        setSelectedArtifact(id);
      } else if (mimeType.startsWith('image/')) {
        const url = URL.createObjectURL(blob);
        setPreview(url);
        setSelectedArtifact(id);
      }
    } catch (err) {
      console.error('Preview failed:', err);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  if (loading) {
    return <div style={styles.container}><p style={styles.loading}>Loading artifacts...</p></div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Artifacts</h3>
        {usage && (
          <span style={styles.usage}>
            {usage.count} files • {formatBytes(usage.totalBytes)}
          </span>
        )}
      </div>

      {artifacts.length === 0 ? (
        <p style={styles.empty}>No artifacts generated yet</p>
      ) : (
        <div style={styles.list}>
          {artifacts.map(artifact => (
            <div key={artifact.id}>
              <div style={styles.artifact}>
                <div style={styles.artifactInfo}>
                  <span style={styles.artifactName}>{artifact.name}</span>
                  <span style={styles.artifactMeta}>
                    {artifact.mime_type} • {formatBytes(artifact.size_bytes)}
                  </span>
                </div>
                <div style={styles.actions}>
                  {(artifact.mime_type.startsWith('text/') || 
                    artifact.mime_type === 'application/json' ||
                    artifact.mime_type.startsWith('image/')) && (
                    <button
                      style={styles.previewBtn}
                      onClick={() => handlePreview(artifact.id, artifact.mime_type)}
                    >
                      {selectedArtifact === artifact.id ? '▲ Hide' : '▼ Preview'}
                    </button>
                  )}
                  <button
                    style={styles.downloadBtn}
                    onClick={() => handleDownload(artifact.id, artifact.name)}
                  >
                    ↓ Download
                  </button>
                </div>
              </div>
              {selectedArtifact === artifact.id && preview && (
                <div style={styles.preview}>
                  {artifact.mime_type.startsWith('image/') ? (
                    <img src={preview} alt={artifact.name} style={styles.previewImage} />
                  ) : (
                    <pre style={styles.previewText}>{preview}</pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#111', borderRadius: 8, padding: 16, marginBottom: 16 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 16, color: '#e5e5e5', margin: 0 },
  usage: { color: '#666', fontSize: 12 },
  loading: { color: '#666', fontSize: 14 },
  empty: { color: '#666', fontSize: 13, textAlign: 'center' as const },
  list: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  artifact: {
    background: '#1a1a1a', borderRadius: 6, padding: 10,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    border: '1px solid #222',
  },
  artifactInfo: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  artifactName: { color: '#e5e5e5', fontSize: 13, fontWeight: 500 },
  artifactMeta: { color: '#666', fontSize: 11 },
  actions: { display: 'flex', gap: 6 },
  previewBtn: {
    background: '#333', color: '#aaa', border: 'none', borderRadius: 4,
    padding: '4px 8px', fontSize: 11, cursor: 'pointer',
  },
  downloadBtn: {
    background: '#2563eb', color: 'white', border: 'none', borderRadius: 4,
    padding: '4px 8px', fontSize: 11, cursor: 'pointer',
  },
  preview: {
    background: '#0a0a0a', borderRadius: 6, padding: 12, marginTop: 8,
    border: '1px solid #222', maxHeight: 300, overflow: 'auto',
  },
  previewText: {
    color: '#aaa', fontSize: 12, fontFamily: 'monospace',
    margin: 0, whiteSpace: 'pre-wrap' as const, wordBreak: 'break-all' as const,
  },
  previewImage: { maxWidth: '100%', maxHeight: 250 },
};
