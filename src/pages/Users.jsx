import { useState, useEffect, useCallback } from 'react';
import { userStore, auth, ROLE_LABELS } from '../lib/auth';
import { Plus, Pencil, Trash2, Power, X, Eye, EyeOff, Crown, ShieldCheck } from 'lucide-react';

const ROLES = ['admin', 'manager', 'seller'];

export default function Users() {
  const isAdmin = auth.isAdmin();
  const currentUserId = auth.currentUserId();

  const [users, setUsers] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'seller' });
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const list = await userStore.list();
    setUsers(list);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (!isAdmin) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-3 text-gray-500 mt-16">
        <ShieldCheck className="w-10 h-10 text-gray-300" />
        <p className="font-medium">Sem permissão para acessar esta página.</p>
      </div>
    );
  }

  function openNew() {
    setForm({ name: '', email: '', password: '', role: 'seller' });
    setError('');
    setShowPass(false);
    setModal('new');
  }

  function openEdit(user) {
    setForm({ name: user.name, email: user.email || '', password: '', role: user.role });
    setError('');
    setShowPass(false);
    setModal(user);
  }

  async function save() {
    if (!form.name.trim() || !form.email.trim()) { setError('Nome e e-mail são obrigatórios.'); return; }

    if (modal === 'new') {
      if (!form.password.trim()) { setError('Defina uma senha.'); return; }
      const result = await userStore.create(form);
      if (result?.error) { setError(result.error); return; }
    } else {
      const data = { name: form.name, role: form.role };
      await userStore.update(modal.id, data);
    }

    await refresh();
    setModal(null);
  }

  async function remove(user) {
    if (!confirm(`Remover ${user.name}?`)) return;
    const result = await userStore.remove(user.id);
    if (result?.error) alert(result.error);
    else await refresh();
  }

  async function toggle(user) {
    await userStore.toggleActive(user.id);
    await refresh();
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Usuários</h1>
          <p className="text-sm text-gray-400 mt-0.5">Gerencie quem tem acesso ao FlowMate</p>
        </div>
        <button onClick={openNew}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-xl flex items-center gap-2 transition-colors">
          <Plus className="w-4 h-4" /> Novo usuário
        </button>
      </div>

      <div className="space-y-3">
        {users.map(user => {
          const role = ROLE_LABELS[user.role] || { label: user.role, color: '#888' };
          const isMe = user.id === currentUserId;
          return (
            <div key={user.id}
              className={`bg-white border rounded-2xl px-4 py-3.5 flex items-center gap-3 transition-opacity ${!user.active ? 'opacity-50' : ''}`}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                style={{ backgroundColor: role.color }}>
                {user.name.slice(0, 1).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-800 text-sm">{user.name}</span>
                  {isMe && <span className="text-xs text-gray-400">(você)</span>}
                  {user.is_primary && <Crown className="w-3.5 h-3.5 text-yellow-500" title="Admin primário" />}
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: role.color + '20', color: role.color }}>
                    {role.label}
                  </span>
                  {!user.active && (
                    <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">Inativo</span>
                  )}
                </div>
              </div>

              {!user.is_primary && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggle(user)} title={user.active ? 'Desativar' : 'Ativar'}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                    <Power className="w-4 h-4" />
                  </button>
                  <button onClick={() => openEdit(user)} title="Editar"
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-500 transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  {!isMe && (
                    <button onClick={() => remove(user)} title="Remover"
                      className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {users.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-10">Nenhum usuário ainda</p>
        )}
      </div>

      {modal !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-lg">{modal === 'new' ? 'Novo usuário' : 'Editar usuário'}</h2>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Nome *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Nome completo"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>

              {modal === 'new' && (
                <>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">E-mail *</label>
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="email@empresa.com"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Senha *</label>
                    <div className="relative">
                      <input type={showPass ? 'text' : 'password'} value={form.password}
                        onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                        placeholder="Senha de acesso"
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                      <button type="button" onClick={() => setShowPass(p => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">Papel</label>
                <div className="space-y-2">
                  {ROLES.map(r => {
                    const rl = ROLE_LABELS[r];
                    return (
                      <button key={r} type="button" onClick={() => setForm(f => ({ ...f, role: r }))}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors text-sm
                          ${form.role === r ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: rl.color }} />
                        <div>
                          <span className="font-medium" style={{ color: form.role === r ? rl.color : '#374151' }}>{rl.label}</span>
                          <span className="text-xs text-gray-400 block">{rl.desc}</span>
                        </div>
                        {form.role === r && <span className="ml-auto text-blue-500 text-xs">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {error && <div className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setModal(null)}
                className="flex-1 border border-gray-200 rounded-xl py-2 text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={save}
                className="flex-1 bg-blue-600 text-white rounded-xl py-2 text-sm font-medium hover:bg-blue-700">
                {modal === 'new' ? 'Criar' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
