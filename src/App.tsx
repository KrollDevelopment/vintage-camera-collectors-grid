/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Camera, 
  Settings2, 
  Download, 
  RefreshCw, 
  Grid3X3, 
  Layers, 
  Info,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Maximize2,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { jsPDF } from 'jspdf';

// --- Utility ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface CameraData {
  id: string;
  name: string;
  year: string;
  description: string;
  width_mm: number;
  height_mm: number;
  depth_mm: number;
  imageUrl?: string;
  status: 'pending' | 'generating' | 'completed' | 'error';
}

type ShelfMaterial = 'wood' | 'marble' | 'glass' | 'brushed-metal' | 'stone';

interface GenerationConfig {
  count: number;
  material: ShelfMaterial;
  resolution: '1080p' | '2K' | '4K';
  aspectRatio: '16:9' | '4:3' | '1:1';
}

// --- Constants ---
const MATERIALS: { id: ShelfMaterial; name: string; class: string }[] = [
  { id: 'wood', name: 'Vintage Oak', class: 'bg-[#3d2b1f] border-[#2a1d15]' },
  { id: 'marble', name: 'Carrara Marble', class: 'bg-[#e5e5e5] border-[#d1d1d1]' },
  { id: 'glass', name: 'Frosted Glass', class: 'bg-white/10 backdrop-blur-md border-white/20' },
  { id: 'brushed-metal', name: 'Brushed Steel', class: 'bg-[#a0a0a0] border-[#808080]' },
  { id: 'stone', name: 'Dark Slate', class: 'bg-[#2c2c2c] border-[#1a1a1a]' },
];

const RESOLUTIONS = {
  '1080p': { w: 1920, h: 1080 },
  '2K': { w: 2560, h: 1440 },
  '4K': { w: 3840, h: 2160 },
};

const generateCellBackgroundImage = async (materialId: string): Promise<string> => {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  let bgColor = '#3d2b1f';
  if (materialId === 'marble') bgColor = '#e5e5e5';
  if (materialId === 'glass') bgColor = '#1a1a1a';
  if (materialId === 'brushed-metal') bgColor = '#a0a0a0';
  if (materialId === 'stone') bgColor = '#2c2c2c';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, 1024, 1024);

  if (materialId === 'wood') {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = "https://www.transparenttextures.com/patterns/wood-pattern.png";
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      const pattern = ctx.createPattern(img, 'repeat');
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, 1024, 1024);
      }
    } catch (e) {
      console.warn("Could not load wood pattern", e);
    }
  }

  // Add recessed shadow effect
  ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
  ctx.fillRect(0, 0, 1024, 1024);

  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.split(',')[1];
};

// --- App Component ---
export default function App() {
  const [config, setConfig] = useState<GenerationConfig>({
    count: 6,
    material: 'wood',
    resolution: '1080p',
    aspectRatio: '16:9',
  });

  const [cameras, setCameras] = useState<CameraData[]>([]);
  const [isGeneratingList, setIsGeneratingList] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<CameraData | null>(null);

  const aiRef = useRef<GoogleGenAI | null>(null);

  useEffect(() => {
    aiRef.current = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  }, []);

  const generateCameraList = async () => {
    if (!aiRef.current) return;
    setIsGeneratingList(true);
    setError(null);
    setCameras([]);

    try {
      const response = await aiRef.current.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: `Generate a list of ${config.count} historically significant vintage cameras. 
        Include cameras from different eras (1800s to 1980s).
        For each camera, provide:
        - name
        - year
        - a brief description
        - approximate real-world dimensions in millimeters (width, height, depth).
        Return the data as a JSON array of objects.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                year: { type: Type.STRING },
                description: { type: Type.STRING },
                width_mm: { type: Type.NUMBER },
                height_mm: { type: Type.NUMBER },
                depth_mm: { type: Type.NUMBER },
              },
              required: ["name", "year", "description", "width_mm", "height_mm", "depth_mm"],
            },
          },
        },
      });

      const list = JSON.parse(response.text) as any[];
      const formattedList: CameraData[] = list.map((item, idx) => ({
        ...item,
        id: `cam-${idx}-${Date.now()}`,
        status: 'pending',
      }));

      setCameras(formattedList);
      setIsGeneratingList(false);
      
      // Start generating images automatically
      generateImages(formattedList);
    } catch (err) {
      console.error(err);
      setError("Failed to generate camera list. Please try again.");
      setIsGeneratingList(false);
    }
  };

  const generateImages = async (list: CameraData[]) => {
    if (!aiRef.current) return;
    setIsGeneratingImages(true);

    const updatedCameras = [...list];
    const base64Bg = await generateCellBackgroundImage(config.material);

    for (let i = 0; i < updatedCameras.length; i++) {
      const camera = updatedCameras[i];
      setCameras(prev => prev.map(c => c.id === camera.id ? { ...c, status: 'generating' } : c));

      try {
        const prompt = `Add a high-quality, professional studio photograph of a ${camera.name} (${camera.year}) to this background. 
        The camera should be as large as possible within the frame.
        PERFECT ORTHOGRAPHIC PROJECTION. Zero perspective distortion. Flat front-on view.
        The camera MUST be positioned at the absolute bottom edge of the image frame.
        Include a soft, realistic contact shadow directly beneath the camera.
        Do not add any floor lines, shelves, or extra props. Just the camera integrated into the provided background.
        Historically accurate details.`;

        const response = await aiRef.current.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: { 
            parts: [
              {
                inlineData: {
                  data: base64Bg,
                  mimeType: 'image/png'
                }
              },
              { text: prompt }
            ] 
          },
          config: {
            imageConfig: {
              aspectRatio: "1:1",
            },
          },
        });

        let imageUrl = '';
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            imageUrl = `data:image/png;base64,${part.inlineData.data}`;
            break;
          }
        }

        if (imageUrl) {
          setCameras(prev => prev.map(c => c.id === camera.id ? { ...c, imageUrl, status: 'completed' } : c));
        } else {
          throw new Error("No image data received");
        }
      } catch (err) {
        console.error(`Error generating image for ${camera.name}:`, err);
        setCameras(prev => prev.map(c => c.id === camera.id ? { ...c, status: 'error' } : c));
      }
    }

    setIsGeneratingImages(false);
  };

  const currentMaterial = MATERIALS.find(m => m.id === config.material) || MATERIALS[0];

  const downloadGrid = async () => {
    const canvas = document.createElement('canvas');
    const res = RESOLUTIONS[config.resolution];
    canvas.width = res.w;
    canvas.height = res.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fill background (shelf material)
    ctx.fillStyle = currentMaterial.id === 'wood' ? '#3d2b1f' : 
                   currentMaterial.id === 'marble' ? '#e5e5e5' :
                   currentMaterial.id === 'glass' ? '#1a1a1a' :
                   currentMaterial.id === 'brushed-metal' ? '#a0a0a0' : '#2c2c2c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cols = config.count > 6 ? 4 : 3;
    const rows = Math.ceil(config.count / cols);
    
    // Calculate grid dimensions (proportional to 1080p scale)
    const scaleFactor = canvas.width / 1920;
    const gap = 16 * scaleFactor;
    const padding = 24 * scaleFactor;
    
    const availableW = canvas.width - (padding * 2) - (gap * (cols - 1));
    const availableH = canvas.height - (padding * 2) - (gap * (rows - 1));
    const cellW = availableW / cols;
    const cellH = availableH / rows;

    // Draw cells and cameras
    for (let i = 0; i < cameras.length; i++) {
      const camera = cameras[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      
      const x = padding + col * (cellW + gap);
      const y = padding + row * (cellH + gap);
      
      // Draw cell background (recessed look)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.fillRect(x, y, cellW, cellH);
      
      // Draw subtle inner shadow border for the cell
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, cellW, cellH);
      
      if (!camera.imageUrl) continue;

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = camera.imageUrl;
      
      await new Promise((resolve) => {
        img.onload = () => {
          const imgAspect = img.width / img.height;
          const cellAspect = cellW / cellH;
          let drawW, drawH, drawX, drawY;
          
          // Implement object-cover logic
          if (imgAspect > cellAspect) {
            // Image is wider than cell
            drawH = cellH;
            drawW = cellH * imgAspect;
            drawX = x + (cellW - drawW) / 2;
            drawY = y;
          } else {
            // Image is taller than cell
            drawW = cellW;
            drawH = cellW / imgAspect;
            drawX = x;
            drawY = y + (cellH - drawH) / 2;
          }
          
          // Clip to cell bounds
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, cellW, cellH);
          ctx.clip();
          
          ctx.drawImage(img, drawX, drawY, drawW, drawH);
          ctx.restore();
          
          resolve(null);
        };
      });
    }

    // Trigger download
    const link = document.createElement('a');
    link.download = `vintage-camera-grid-${config.resolution}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const downloadPDF = async () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    let yPos = margin;

    // Title
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text("ARCHIVE.01 - Historical Database", margin, yPos);
    yPos += 15;

    for (const camera of cameras) {
      if (!camera.imageUrl) continue;

      // Check pagination (need about 50 units of space per camera)
      if (yPos > pageHeight - 60) {
        doc.addPage();
        yPos = margin;
      }

      // Add Image (40x40)
      doc.addImage(camera.imageUrl, 'PNG', margin, yPos, 40, 40);

      // Add Text
      const textX = margin + 45;
      let textY = yPos + 6;

      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text(`${camera.name} (${camera.year})`, textX, textY);
      textY += 6;

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 100, 100);
      const dims = `Dimensions: ${camera.width_mm}mm W x ${camera.height_mm}mm H x ${camera.depth_mm}mm D`;
      doc.text(dims, textX, textY);
      textY += 6;

      doc.setTextColor(0, 0, 0);
      const descLines = doc.splitTextToSize(camera.description, pageWidth - margin - textX);
      doc.text(descLines, textX, textY);

      yPos += 50; // Move down for next camera
    }

    doc.save(`vintage-camera-archive-${config.resolution}.pdf`);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/40 backdrop-blur-2xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/10 flex items-center justify-center shadow-2xl">
              <Camera className="text-emerald-500 w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight font-display">ARCHIVE.01</h1>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 font-bold">System Online / Historical Database</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={generateCameraList}
              disabled={isGeneratingList || isGeneratingImages}
              className="group flex items-center gap-2 px-6 py-2.5 bg-white text-black hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed font-bold rounded-full transition-all active:scale-95"
            >
              {isGeneratingList || isGeneratingImages ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Grid3X3 className="w-4 h-4 group-hover:rotate-90 transition-transform" />
              )}
              <span className="text-xs uppercase tracking-widest">Rebuild Archive</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-12">
        {/* Sidebar Controls */}
        <aside className="space-y-8">
          <section className="bg-zinc-900/50 border border-white/5 rounded-3xl p-8 space-y-8 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-zinc-500">
                <Settings2 className="w-4 h-4" />
                <h2 className="text-[10px] font-black uppercase tracking-[0.2em]">Parameters</h2>
              </div>
              <span className="text-[10px] font-mono text-zinc-600">v1.0.4</span>
            </div>

            {/* Camera Count */}
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Unit Count</label>
                <span className="text-2xl font-display font-bold text-emerald-500 leading-none">{config.count}</span>
              </div>
              <input 
                type="range" 
                min="2" 
                max="12" 
                step="1"
                value={config.count}
                onChange={(e) => setConfig(prev => ({ ...prev, count: parseInt(e.target.value) }))}
                className="w-full accent-emerald-500 bg-white/5 rounded-full h-1 appearance-none cursor-pointer"
              />
            </div>

            {/* Shelf Material */}
            <div className="space-y-4">
              <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Substrate Material</label>
              <div className="grid grid-cols-1 gap-2">
                {MATERIALS.map((mat) => (
                  <button
                    key={mat.id}
                    onClick={() => setConfig(prev => ({ ...prev, material: mat.id }))}
                    className={cn(
                      "group px-4 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all flex items-center justify-between",
                      config.material === mat.id 
                        ? "bg-emerald-500 text-black border-emerald-500" 
                        : "bg-white/5 border-white/5 text-zinc-500 hover:border-white/20 hover:text-zinc-300"
                    )}
                  >
                    <span>{mat.name}</span>
                    <ChevronRight className={cn("w-3 h-3 transition-transform", config.material === mat.id ? "translate-x-0" : "-translate-x-2 opacity-0 group-hover:opacity-100 group-hover:translate-x-0")} />
                  </button>
                ))}
              </div>
            </div>

            {/* Resolution */}
            <div className="space-y-4">
              <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Output Matrix</label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(RESOLUTIONS) as Array<keyof typeof RESOLUTIONS>).map((res) => (
                  <button
                    key={res}
                    onClick={() => setConfig(prev => ({ ...prev, resolution: res }))}
                    className={cn(
                      "px-4 py-2 rounded-lg text-[10px] font-bold border transition-all",
                      config.resolution === res 
                        ? "bg-white text-black border-white" 
                        : "bg-white/5 border-white/5 text-zinc-500 hover:border-white/20 hover:text-zinc-300"
                    )}
                  >
                    {res}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Technical Specs */}
          <div className="p-8 border border-white/5 rounded-3xl space-y-4">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">System Specs</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-zinc-600">PROJECTION</span>
                <span className="text-zinc-400 uppercase">Orthographic</span>
              </div>
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-zinc-600">SCALING</span>
                <span className="text-zinc-400 uppercase">Relative (mm)</span>
              </div>
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-zinc-600">ENGINE</span>
                <span className="text-zinc-400 uppercase">Gemini 2.5 Flash</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Display */}
        <div className="space-y-8">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-6 py-4 rounded-2xl text-xs font-bold uppercase tracking-widest flex items-center gap-4">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              {error}
            </div>
          )}

          {/* The Grid Container */}
          <div className="relative group">
            <div 
              className={cn(
                "w-full aspect-video rounded-[2rem] overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.5)] transition-all duration-1000 border-[16px] p-4 gap-4",
                currentMaterial.class,
                config.count > 6 ? "grid grid-cols-4" : "grid grid-cols-3"
              )}
              style={{
                backgroundImage: config.material === 'wood' ? 'url("https://www.transparenttextures.com/patterns/wood-pattern.png")' : 'none',
              }}
            >
              {cameras.length === 0 && !isGeneratingList ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-300 space-y-6 bg-black/40 backdrop-blur-sm z-10 m-4 rounded-xl">
                  <div className="w-24 h-24 rounded-full border-2 border-zinc-500 flex items-center justify-center">
                    <Layers className="w-10 h-10 opacity-50" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-xs font-black uppercase tracking-[0.3em]">Awaiting Initialization</p>
                    <p className="text-[10px] text-zinc-400">Select parameters and trigger generation</p>
                  </div>
                </div>
              ) : (
                <>
                  {cameras.map((camera, idx) => (
                    <motion.div
                      key={camera.id}
                      layoutId={camera.id}
                      onClick={() => setSelectedCamera(camera)}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="relative group/cell cursor-pointer overflow-hidden bg-black/10 shadow-[inset_0_4px_20px_rgba(0,0,0,0.3)] rounded-xl transition-all duration-500"
                    >
                      <div className="absolute inset-0 flex items-center justify-center p-12 z-10 pointer-events-none">
                        {camera.status === 'generating' && (
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-8 h-8 rounded-full border-2 border-emerald-500/20 border-t-emerald-500 animate-spin" />
                            <span className="text-[8px] text-zinc-400 font-black uppercase tracking-[0.3em]">Processing</span>
                          </div>
                        )}
                        {camera.status === 'error' && (
                          <div className="text-red-500 flex flex-col items-center gap-2">
                            <Camera className="w-8 h-8" />
                            <span className="text-[8px] uppercase font-black tracking-widest">Error</span>
                          </div>
                        )}
                      </div>

                      {camera.imageUrl && (
                        <motion.img
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          src={camera.imageUrl}
                          alt={camera.name}
                          className="absolute inset-0 w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      )}

                      {/* Cell Metadata */}
                      <div className="absolute top-4 left-4 opacity-30 group-hover/cell:opacity-100 transition-opacity z-20">
                        <span className="text-[9px] font-mono text-zinc-400">#{String(idx + 1).padStart(2, '0')}</span>
                      </div>

                      {/* Label */}
                      <div className="absolute bottom-6 left-6 right-6 translate-y-4 opacity-0 group-hover/cell:translate-y-0 group-hover/cell:opacity-100 transition-all duration-500 z-20">
                        <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 flex items-center justify-between shadow-2xl">
                          <div className="truncate pr-4">
                            <p className="text-[10px] font-black text-white uppercase tracking-widest truncate">{camera.name}</p>
                            <p className="text-[9px] font-mono text-emerald-500 mt-1">{camera.year}</p>
                          </div>
                          <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                            <Maximize2 className="w-3 h-3 text-white" />
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </>
              )}
            </div>

            {/* Overlay Controls */}
            {cameras.length > 0 && !isGeneratingImages && (
              <div className="absolute -top-4 -right-4 flex gap-2">
                <button 
                  onClick={downloadPDF}
                  className="flex items-center gap-2 px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl shadow-2xl transition-all active:scale-95 border border-white/10"
                >
                  <FileText className="w-4 h-4" />
                  <span>Export PDF</span>
                </button>
                <button 
                  onClick={downloadGrid}
                  className="flex items-center gap-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl shadow-2xl transition-all active:scale-95"
                >
                  <Download className="w-4 h-4" />
                  <span>Export Matrix</span>
                </button>
              </div>
            )}
          </div>

          {/* Status Bar */}
          {(isGeneratingList || isGeneratingImages) && (
            <div className="bg-zinc-900/80 border border-white/5 rounded-[2rem] p-8 flex items-center justify-between backdrop-blur-xl">
              <div className="flex items-center gap-6">
                <div className="relative">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-black uppercase tracking-[0.2em]">
                    {isGeneratingList ? "Analyzing Archives" : "Synthesizing Assets"}
                  </h4>
                  <p className="text-[10px] font-mono text-zinc-500 mt-1">
                    {isGeneratingList ? "Retrieving historical metadata..." : `Unit ${cameras.filter(c => c.status === 'completed').length + 1} of ${config.count} in progress`}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="text-[10px] font-mono text-emerald-500">
                  {Math.round((cameras.filter(c => c.status === 'completed').length / config.count) * 100)}%
                </span>
                <div className="w-48 h-1 bg-white/5 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                    initial={{ width: 0 }}
                    animate={{ 
                      width: `${(cameras.filter(c => c.status === 'completed').length / config.count) * 100}%` 
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedCamera && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedCamera(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-4xl bg-[#1a1a1a] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row"
            >
              <div className="w-full md:w-1/2 aspect-square bg-zinc-200 flex items-center justify-center p-12 relative overflow-hidden">
                {/* Subtle background texture for the modal */}
                <div className="absolute inset-0 opacity-50 bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:16px_16px]" />
                {selectedCamera.imageUrl ? (
                  <img 
                    src={selectedCamera.imageUrl} 
                    alt={selectedCamera.name}
                    className="absolute inset-0 w-full h-full object-cover z-10"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <Camera className="w-20 h-20 text-zinc-400 relative z-10" />
                )}
              </div>
              <div className="w-full md:w-1/2 p-8 md:p-12 flex flex-col justify-between">
                <div className="space-y-6">
                  <div>
                    <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-bold uppercase tracking-widest border border-emerald-500/20">
                      {selectedCamera.year}
                    </span>
                    <h2 className="text-3xl font-bold mt-4 tracking-tight">{selectedCamera.name}</h2>
                  </div>
                  
                  <div className="space-y-4">
                    <p className="text-zinc-400 leading-relaxed text-sm">
                      {selectedCamera.description}
                    </p>
                    
                    <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/5">
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Width</p>
                        <p className="text-sm font-mono">{selectedCamera.width_mm}mm</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Height</p>
                        <p className="text-sm font-mono">{selectedCamera.height_mm}mm</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Depth</p>
                        <p className="text-sm font-mono">{selectedCamera.depth_mm}mm</p>
                      </div>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setSelectedCamera(null)}
                  className="mt-8 w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-semibold transition-all"
                >
                  Close Archive
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-white/5 mt-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 opacity-30 grayscale">
            <Camera className="w-4 h-4" />
            <span className="text-[10px] uppercase tracking-[0.3em] font-bold">Vintage Collector v1.0</span>
          </div>
          <div className="flex gap-8">
            <a href="#" className="text-[10px] uppercase tracking-widest text-zinc-600 hover:text-emerald-500 transition-colors">Documentation</a>
            <a href="#" className="text-[10px] uppercase tracking-widest text-zinc-600 hover:text-emerald-500 transition-colors">API Status</a>
            <a href="#" className="text-[10px] uppercase tracking-widest text-zinc-600 hover:text-emerald-500 transition-colors">Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
