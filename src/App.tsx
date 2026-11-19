/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
// @ts-ignore - JSX dashboard component
import DashboardApp from './components/DashboardApp.jsx';
import PipelineInspectorModal from './PipelineInspectorModal';

export default function App() {
  const [docsOpen, setDocsOpen] = useState(false);

  return (
    <>
      <DashboardApp onOpenDocsModal={() => setDocsOpen(true)} />
      <PipelineInspectorModal
        isOpen={docsOpen}
        onClose={() => setDocsOpen(false)}
      />
    </>
  );
}

