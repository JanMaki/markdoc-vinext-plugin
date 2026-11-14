/**
 * bun test の preload。全テストファイルは 1 プロセスで実行され、React は最初の読み込み時の NODE_ENV で
 * development / production のビルドを選ぶため、React を読み込む前に固定する。
 */
process.env.NODE_ENV = 'production';
