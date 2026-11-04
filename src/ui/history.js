// Left-rail history and saved sessions lists (rendered from the session store; clicks navigate or load).
import { ageLabel } from '../core/cache.js';
import { h, setChildren } from './dom.js';
import { on, store } from './state.js';

// Mounts the history and sessions lists and keeps them current.
export function mountHistory({ historyEl, sessionsEl, onOpenGene, onOpenPathway, onOpenSession }) {
  const render = () => {
    const history = store.getHistory();
    setChildren(
      historyEl,
      history.length === 0
        ? h('p', { class: 'muted' }, 'No searches or analyses yet.')
        : h(
            'ul',
            { class: 'rail-list' },
            history.slice(0, 8).map((entry) =>
              h(
                'li',
                { class: 'row-between' },
                h(
                  'button',
                  {
                    class: 'link-btn',
                    type: 'button',
                    title: `${entry.type} · ${ageLabel(Date.parse(entry.at))}`,
                    onclick: () =>
                      entry.type === 'gene'
                        ? onOpenGene(entry.key)
                        : entry.type === 'pathway'
                          ? onOpenPathway(entry.key)
                          : onOpenSession(entry.key),
                  },
                  entry.label,
                ),
                h(
                  'button',
                  {
                    class: 'icon-x',
                    type: 'button',
                    'aria-label': `Remove ${entry.label} from history`,
                    onclick: () => {
                      store.removeHistory(entry.type, entry.key);
                      render();
                    },
                  },
                  '✕',
                ),
              ),
            ),
          ),
      history.length > 0 &&
        h(
          'button',
          {
            class: 'link-btn small',
            type: 'button',
            onclick: () => {
              store.clearHistory();
              render();
            },
          },
          'Clear history',
        ),
    );
    const sessions = store.listSessions();
    setChildren(
      sessionsEl,
      sessions.length === 0
        ? h('p', { class: 'muted' }, 'No saved sessions yet.')
        : h(
            'ul',
            { class: 'rail-list' },
            sessions.map((s) =>
              h(
                'li',
                { class: 'row-between' },
                h(
                  'button',
                  {
                    class: 'link-btn',
                    type: 'button',
                    title: `Reactome release ${s.dataVersion ?? 'not available'}`,
                    onclick: () => onOpenSession(s.id),
                  },
                  `${s.label} · ${ageLabel(Date.parse(s.createdAt))}`,
                ),
                h(
                  'button',
                  {
                    class: 'icon-x',
                    type: 'button',
                    'aria-label': `Delete saved session from ${s.createdAt}`,
                    onclick: () => {
                      store.deleteSession(s.id);
                      render();
                    },
                  },
                  '✕',
                ),
              ),
            ),
          ),
    );
  };
  on('sessions-changed', render);
  on('history-changed', render);
  render();
}
