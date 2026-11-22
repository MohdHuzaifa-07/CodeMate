/** A simple full-page message, used for errors and "not found" screens. */
export default function CenteredMessage({ title, text, children }) {
  return (
    <div className="d-flex min-vh-100 align-items-center justify-content-center p-4">
      <div className="text-center" style={{ maxWidth: 420 }}>
        <h1 className="h3 mb-2">{title}</h1>
        {text && <p className="text-body-secondary mb-4">{text}</p>}
        {children}
      </div>
    </div>
  );
}