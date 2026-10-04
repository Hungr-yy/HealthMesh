import { CAPABILITIES, LANGUAGE_CAPABILITIES } from '@shared/capabilities';

const yn = (b: boolean) => (b ? 'Yes' : 'No');

/** Honest capability matrix, rendered from the same source as docs/CAPABILITIES.md. */
export function CapabilitiesApp() {
  return (
    <div data-testid="capabilities-root">
      <h1>Capability matrix</h1>
      <p className="muted small">
        What is simulated, implemented, evaluated and still future. <strong>Evaluated</strong> means
        checked by automated tests or scripts in this repository only: nothing has been evaluated
        with real users, real radios or in the field. This is a prototype, not production-ready.
      </p>
      <div className="table-scroll">
        <table className="data" data-testid="capabilities-table">
          <caption className="sr-only">Capabilities by status</caption>
          <thead>
            <tr>
              <th scope="col">Capability</th>
              <th scope="col">Simulated</th>
              <th scope="col">Implemented</th>
              <th scope="col">Evaluated</th>
              <th scope="col">Future / missing</th>
              <th scope="col">Evidence and caveats</th>
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((c) => (
              <tr key={c.area + c.capability}>
                <th scope="row">
                  <span className="small muted">{c.area}</span>
                  <br />
                  {c.capability}
                </th>
                <td>{yn(c.simulated)}</td>
                <td>{yn(c.implemented)}</td>
                <td>{c.evaluated}</td>
                <td>{c.future}</td>
                <td>{c.evidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Language capability matrix</h2>
      <div className="table-scroll">
        <table className="data" data-testid="language-matrix">
          <caption className="sr-only">Language capabilities</caption>
          <thead>
            <tr>
              <th scope="col">Language</th>
              <th scope="col">UI text</th>
              <th scope="col">Speech input</th>
              <th scope="col">Translation</th>
              <th scope="col">Review status</th>
            </tr>
          </thead>
          <tbody>
            {LANGUAGE_CAPABILITIES.map((l) => (
              <tr key={l.code}>
                <th scope="row">{l.language}</th>
                <td>{l.uiText}</td>
                <td>{l.speech}</td>
                <td>{l.translation}</td>
                <td>{l.review}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
