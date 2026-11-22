export default function UserList({ users, myId }) {
  return (
    <section aria-label="People in this room">
      <h2 className="h6 text-uppercase text-body-secondary mb-2">People ({users.length})</h2>
      <ul className="list-group">
        {users.map((u) => (
          <li
            key={u.id}
            className={`list-group-item d-flex align-items-center gap-2 ${u.connected ? '' : 'opacity-50'}`}
          >
            <span className="text-truncate flex-grow-1">{u.name}</span>
            {u.id === myId && <span className="badge text-bg-secondary">You</span>}
            {u.isHost && <span className="badge text-bg-primary">Host</span>}
            {!u.connected && <span className="small text-body-secondary">reconnecting…</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}