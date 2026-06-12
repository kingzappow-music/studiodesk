import { supabase } from '../lib/supabaseClient';

const extractPeaks = (channelData: Float32Array, count: number): number[] => {
  const blockSize = Math.floor(channelData.length / count);
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    let max = 0;
    for (let j = 0; j < blockSize; j++) {
      const v = Math.abs(channelData[i * blockSize + j] ?? 0);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  return peaks;
};

export const generatePeaks = async (audioBuffer: AudioBuffer, count = 800): Promise<number[]> =>
  extractPeaks(audioBuffer.getChannelData(0), count);

export const generatePeaksStereo = async (
  audioBuffer: AudioBuffer,
  count = 800,
): Promise<{ left: number[]; right: number[] | null }> => ({
  left:  extractPeaks(audioBuffer.getChannelData(0), count),
  right: audioBuffer.numberOfChannels >= 2
    ? extractPeaks(audioBuffer.getChannelData(1), count)
    : null,
});

export const uploadAudioToSupabase = async (blob: Blob, fileName: string): Promise<string> => {
  const path = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const { error } = await supabase.storage
    .from('audio_files')
    .upload(path, blob, { contentType: blob.type || 'audio/wav' });

  if (error) {
    console.error('Supabase upload failed, falling back to local blob:', error);
    return URL.createObjectURL(blob);
  }

  const { data } = supabase.storage.from('audio_files').getPublicUrl(path);
  return data.publicUrl;
};
