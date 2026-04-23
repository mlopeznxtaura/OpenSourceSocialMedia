output "cluster_endpoint"   { value = module.eks.cluster_endpoint }
output "db_endpoint"        { value = aws_db_instance.colossus.endpoint }
output "cluster_name"       { value = module.eks.cluster_name }
output "db_password"        { value = random_password.db.result; sensitive = true }
