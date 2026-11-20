import { Sparkles, Code2, Rocket, Layers, ArrowRight } from 'lucide-react';

export default function App() {
  const suggestions = [
    { title: 'Interactive SaaS Dashboard', desc: 'Analytics charts, user management, and live activity feeds.' },
    { title: 'AI-Powered Creative Tool', desc: 'Content generator, image editor, or smart writing assistant.' },
    { title: 'Full-Featured Productivity App', desc: 'Kanban boards, calendar scheduling, or rich notes.' },
    { title: 'Immersive Casual Game or 3D Sim', desc: 'Interactive canvas, physics simulation, or puzzle game.' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-indigo-500 selection:text-white">
      {/* Background glow effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-to-b from-indigo-500/20 to-transparent blur-3xl rounded-full" />
        <div className="absolute top-1/3 -right-40 w-96 h-96 bg-purple-500/10 blur-3xl rounded-full" />
        <div className="absolute bottom-10 -left-20 w-80 h-80 bg-blue-500/10 blur-3xl rounded-full" />
      </div>

      {/* Top Navbar */}
      <header className="relative z-10 border-b border-slate-800/80 px-6 py-4 backdrop-blur-md bg-slate-950/60">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-400 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <Sparkles className="w-4 h-4" />
            </div>
            <span className="font-semibold tracking-tight text-white text-base">Creative Studio</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 bg-slate-900 px-3 py-1.5 rounded-full border border-slate-800">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Environment Ready
          </div>
        </div>
      </header>

      {/* Main Hero & Options */}
      <main className="relative z-10 max-w-4xl mx-auto px-6 py-16 flex-1 flex flex-col justify-center text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-950/60 border border-indigo-800/60 text-indigo-300 text-xs font-medium mx-auto mb-6 shadow-sm">
          <Rocket className="w-3.5 h-3.5 text-indigo-400" />
          Ready to build your application
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white mb-6">
          Hello! What would you like to{' '}
          <span className="bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
            create today?
          </span>
        </h1>

        <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto mb-12 leading-relaxed">
          Tell me your vision, requirements, or idea, and I will build a complete, interactive, and polished web application for you.
        </p>

        {/* Suggestion cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left max-w-3xl mx-auto w-full">
          {suggestions.map((item, index) => (
            <div
              key={index}
              className="p-5 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-indigo-500/50 hover:bg-slate-900 transition-all duration-200 group"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-slate-100 text-sm group-hover:text-indigo-300 transition-colors">
                  {item.title}
                </h3>
                <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all" />
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-900/80 py-5 text-center text-xs text-slate-500">
        <div className="flex items-center justify-center gap-4">
          <span className="flex items-center gap-1.5">
            <Code2 className="w-3.5 h-3.5" /> React 19 + TypeScript
          </span>
          <span>•</span>
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" /> Tailwind CSS
          </span>
        </div>
      </footer>
    </div>
  );
}
