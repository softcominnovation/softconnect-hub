import type { MediaSourceDiagnostics } from '../../common/media-request-context';

/** Bounded descriptions only: never echo a signed URL or native exception text. */
export function mediaPreparationError(source: MediaSourceDiagnostics): string {
  const code = source.errorCode ?? '';
  let detail: string;
  if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'ENODATA'].includes(code))
    detail =
      'Não foi possível resolver o endereço do servidor do arquivo (DNS).';
  else if (
    code.startsWith('ERR_TLS_') ||
    code.startsWith('ERR_SSL_') ||
    [
      'CERT_HAS_EXPIRED',
      'CERT_NOT_YET_VALID',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    ].includes(code)
  )
    detail =
      'Falha ao estabelecer ou validar a conexão segura (TLS) com o servidor do arquivo.';
  else if (code === 'ECONNRESET' || code === 'ERR_STREAM_PREMATURE_CLOSE')
    detail =
      'A conexão com o servidor do arquivo foi interrompida antes de concluir o download.';
  else if (code === 'ECONNREFUSED')
    detail = 'A conexão com o servidor do arquivo foi recusada.';
  else if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH')
    detail = 'Não foi possível alcançar o servidor do arquivo pela rede.';
  else if (code === 'ETIMEDOUT')
    detail =
      'O tempo de espera pela conexão com o servidor do arquivo terminou.';
  else if (source.stage === 'decode')
    detail =
      'O conteúdo compactado recebido do servidor do arquivo não pôde ser descompactado.';
  else
    detail =
      'Não foi possível concluir a preparação da mídia. A causa não foi identificada; consulte o log da requisição.';
  return `${detail} O envio à Evolution não foi iniciado.`;
}
