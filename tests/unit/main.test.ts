import CassandraPlugin from '../../src/main';

describe('CassandraPlugin', () => {
  it('should be a class', () => {
    expect(CassandraPlugin).toBeDefined();
    expect(typeof CassandraPlugin).toBe('function');
  });

  it('should instantiate', () => {
    const plugin = new (CassandraPlugin as any)();
    expect(plugin).toBeDefined();
  });
});
