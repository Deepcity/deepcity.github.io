import React from 'react';

export default function BlogUpdatesTable({ posts }) {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'sans-serif' }}>
      <thead>
        <tr style={{ backgroundColor: '#f0f0f0' }}>
          <th style={thStyle}>标题</th>
          <th style={thStyle}>更新日期</th>
        </tr>
      </thead>
      <tbody>
        {posts.map(({ id, title, date, url }) => (
          <tr key={id} style={{ borderBottom: '1px solid #ddd' }}>
            <td style={tdStyle}>
              <a href={url} style={{ color: '#007acc', textDecoration: 'none' }} target="_blank" rel="noopener noreferrer">
                {title}
              </a>
            </td>
            <td style={tdStyle}>{new Date(date).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const thStyle = {
  padding: '8px',
  textAlign: 'left',
  borderBottom: '2px solid #ccc',
};

const tdStyle = {
  padding: '8px',
  verticalAlign: 'top',
};
