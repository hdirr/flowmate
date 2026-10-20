import { useState, useEffect } from 'react';
import { labelsApi } from '../lib/labels';
import LabelChips from './LabelChips';

// Seção "Etiquetas" do contato — a MESMA em todo painel lateral (Contatos, Chats, Pipeline).
// Aplica/remove na hora (não depende do "Salvar"). Só etiquetas de usuário: a de sistema nunca
// vai em contato (o seletor não mostra). Chave labels desligada → a seção não aparece.
export default function ContactLabels({ contactId }) {
  const [allLabels, setAllLabels] = useState(null);
  const [canManage, setCanManage] = useState(false);
  const [current, setCurrent] = useState([]);

  useEffect(() => {
    let alive = true;
    setAllLabels(null);
    if (!contactId) return;
    (async () => {
      try {
        const list = await labelsApi.list();
        if (!alive || !list) return;
        const mine = await labelsApi.ofContact(contactId);
        if (!alive) return;
        setAllLabels(list.labels);
        setCanManage(!!list.can_manage);
        setCurrent(mine.labels || []);
      } catch { /* sem etiquetas na tela */ }
    })();
    return () => { alive = false; };
  }, [contactId]);

  async function toggle(label, add) {
    const r = await labelsApi.applyContact(contactId, label.id, add ? 'add' : 'remove');
    setCurrent(r.labels || []);
    window.dispatchEvent(new Event('flowmate:labels')); // listas (Contatos, Chats) recarregam
  }

  // "Criar na hora" (só quem gerencia etiquetas): cria (ou acha a existente) e já aplica.
  async function create(name) {
    const id = await labelsApi.createOrGet(name);
    const list = await labelsApi.list();
    if (list) setAllLabels(list.labels);
    await toggle({ id }, true);
  }

  // Lápis (só quem gerencia): editou nome/cor → recarrega a lista e as do contato.
  async function edited() {
    window.dispatchEvent(new Event('flowmate:labels'));
    try {
      const [list, mine] = await Promise.all([labelsApi.list(), labelsApi.ofContact(contactId)]);
      if (list) setAllLabels(list.labels);
      setCurrent(mine.labels || []);
    } catch { /* a edição já foi salva; a seção atualiza ao reabrir */ }
  }

  if (!allLabels) return null;
  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Etiquetas</h3>
      <LabelChips all={allLabels} current={current} onToggle={toggle} onCreate={canManage ? create : undefined} onEdited={canManage ? edited : undefined} />
    </section>
  );
}
