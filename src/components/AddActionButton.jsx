import { Plus } from 'lucide-react';

export default function AddActionButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full border-2 border-dashed border-gray-300 rounded-xl py-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors flex items-center justify-center gap-2"
    >
      <Plus className="w-4 h-4" /> Adicionar ação
    </button>
  );
}
