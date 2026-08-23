import type { Piece } from '@darkchess/core';
import { assetRegistry } from '../assets/registry';

export function PieceView({ piece }: { piece: Piece }) {
  const src = assetRegistry.piece(piece.type, piece.color, piece.revealed);
  const alt = piece.revealed ? `${piece.color}-${piece.type}` : '背面';
  return <img className="piece" src={src} alt={alt} draggable={false} />;
}
