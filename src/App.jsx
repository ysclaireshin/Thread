import LinearView from './components/LinearView'
import './App.css'

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">Thread</div>
        <nav className="sidebar-nav">
          <a className="nav-item active" href="#">Linear</a>
          <a className="nav-item" href="#">Archive</a>
          <a className="nav-item" href="#">Search</a>
        </nav>
      </aside>
      <main className="main">
        <LinearView />
      </main>
    </div>
  )
}
