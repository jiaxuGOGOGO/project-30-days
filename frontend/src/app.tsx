import React from 'react';
import './app.css';

export interface AppProps {
  children?: React.ReactNode;
}

const App: React.FC<AppProps> = ({ children }) => <>{children}</>;

export default App;
