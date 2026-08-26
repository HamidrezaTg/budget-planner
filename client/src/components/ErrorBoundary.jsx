import React from 'react';

// Shows a readable message instead of a blank page if a render ever fails.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('UI crashed:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="login-wrap">
          <div className="card login-card">
            <h1>Something went wrong</h1>
            <p className="error" style={{ whiteSpace: 'pre-wrap' }}>
              {String(this.state.error?.message || this.state.error)}
            </p>
            <button className="btn primary" onClick={() => window.location.assign('/')}>
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
