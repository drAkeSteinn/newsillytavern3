'use client';

// ============================================
// Avatar Library Picker
// ============================================
// Modal that lists existing avatar files in /public/uploads/avatar/
// and lets the user pick one instead of uploading a new image.

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Upload, ImageIcon, Trash2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AvatarLibraryPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (url: string) => void;
  /** Current avatar URL (to highlight the selected one) */
  currentAvatar?: string;
}

interface UploadedFile {
  url: string;
  filename: string;
  size: number;
  mtime: string;
  mediaType: 'image' | 'video' | 'audio' | 'other';
}

export function AvatarLibraryPicker({
  open,
  onOpenChange,
  onSelect,
  currentAvatar,
}: AvatarLibraryPickerProps) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/uploads/list?type=avatar');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setFiles(data.files);
        }
      }
    } catch (err) {
      console.error('[AvatarLibrary] Error loading files:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadFiles();
    }
  }, [open, loadFiles]);

  // Filtered files
  const filtered = files.filter(f =>
    f.filename.toLowerCase().includes(search.toLowerCase())
  );

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'avatar');

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success) {
        // Refresh the list and select the new file
        await loadFiles();
        setSelected(data.url);
      }
    } catch (err) {
      console.error('[AvatarLibrary] Upload error:', err);
    } finally {
      setUploading(false);
      if (e.target) {
        e.target.value = '';
      }
    }
  };

  const handleConfirm = () => {
    if (selected) {
      onSelect(selected);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4" />
            Seleccionar Avatar
          </DialogTitle>
        </DialogHeader>

        {/* Search + Upload */}
        <div className="flex items-center gap-2 mb-3">
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 flex-1"
          />
          <label className="cursor-pointer">
            <input
              type="file"
              className="hidden"
              accept="image/*"
              onChange={handleUpload}
              disabled={uploading}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              asChild
            >
              <span className="flex items-center gap-1">
                {uploading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                Subir
              </span>
            </Button>
          </label>
        </div>

        {/* Grid of existing avatars */}
        <div className="flex-1 overflow-y-auto min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              Cargando...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-8">
              <ImageIcon className="w-10 h-10 opacity-30 mb-2" />
              <p className="text-sm">No hay avatares disponibles</p>
              <p className="text-xs mt-1">Sube uno nuevo con el botón "Subir"</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
              {filtered.map((file) => (
                <button
                  key={file.url}
                  onClick={() => setSelected(file.url)}
                  className={cn(
                    'relative aspect-square rounded-lg overflow-hidden border-2 transition-all',
                    selected === file.url
                      ? 'border-primary ring-2 ring-primary/30'
                      : 'border-transparent hover:border-muted-foreground/30'
                  )}
                >
                  <img
                    src={file.url}
                    alt={file.filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {selected === file.url && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                      <div className="bg-primary text-primary-foreground rounded-full p-1">
                        <Check className="w-3 h-3" />
                      </div>
                    </div>
                  )}
                  {/* Highlight current avatar */}
                  {currentAvatar === file.url && selected !== file.url && (
                    <div className="absolute top-0.5 right-0.5 bg-blue-500 text-white rounded-full px-1 text-[8px] font-medium">
                      Actual
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!selected}>
            <Check className="w-3.5 h-3.5 mr-1" />
            Seleccionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
